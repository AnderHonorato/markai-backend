// backend/src/services/MultiSessionBot.js
const makeWASocket = require('@whiskeysockets/baileys').default;
const { 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal'); // ✅ ADICIONAR PARA TERMINAL
const { handleIncomingMessage } = require('../bot');

class MultiSessionBot {
    constructor() {
        this.sessions = new Map();
        this.sessionStates = new Map();
        this.authDir = path.join(__dirname, '../../auth_sessions');
        this.reconnectAttempts = new Map(); // Contador de tentativas
        
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }
        
        console.log('📱 MultiSessionBot inicializado');
        console.log('📂 Diretório auth:', this.authDir);
    }

    /**
     * 🔌 RECONECTA SESSÃO EXISTENTE
     */
    async reconnectSession(userId, sessionDir) {
        return new Promise(async (resolve, reject) => {
            try {
                const { version } = await fetchLatestBaileysVersion();
                const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

                const sock = makeWASocket({
                    version,
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
                    },
                    logger: pino({ level: 'silent' }),
                    printQRInTerminal: false,
                    browser: Browsers.macOS('MarkaÍ'),
                    generateHighQualityLinkPreview: true,
                    markOnlineOnConnect: false, // ✅ MUDANÇA CRÍTICA
                    syncFullHistory: false,
                    connectTimeoutMs: 60000,
                    defaultQueryTimeoutMs: 60000,
                    keepAliveIntervalMs: 30000, // ✅ AUMENTADO
                    getMessage: async () => ({ conversation: '' })
                });

                let resolved = false;
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        reject(new Error('TIMEOUT_RECONEXAO'));
                    }
                }, 45000); // ✅ AUMENTADO PARA 45s

                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect } = update;

                    if (connection === 'open') {
                        console.log(`✅ Sessão restaurada: ${userId}`);
                        clearTimeout(timeout);

                        const number = sock.user?.id?.split(':')[0];
                        
                        this.sessionStates.set(userId, {
                            qr: null,
                            code: null,
                            number,
                            state: 'active'
                        });

                        this.sessions.set(userId, sock);
                        
                        // ✅ REGISTRA HANDLER DE MENSAGENS
                        sock.ev.on('messages.upsert', async ({ messages }) => {
                            for (const msg of messages) {
                                await handleIncomingMessage(msg, userId, sock);
                            }
                        });

                        if (!resolved) {
                            resolved = true;
                            resolve();
                        }
                    }

                    if (connection === 'close') {
                        clearTimeout(timeout);
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        
                        console.log(`❌ Desconectado (${statusCode}): ${userId}`);

                        // Logout permanente
                        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                            console.log(`🗑️ Sessão invalidada: ${userId}`);
                            this.cleanupSession(userId, sock);
                        }
                        // Conflito de dispositivo
                        else if (statusCode === DisconnectReason.connectionReplaced || statusCode === 440) {
                            console.log(`⚠️ Conflito de dispositivo: ${userId}`);
                            this.cleanupSession(userId, sock);
                        }
                        // Restart necessário
                        else if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                            console.log(`🔄 Restart solicitado: ${userId}`);
                            // NÃO limpa a sessão - tenta reconectar
                            setTimeout(() => this.reconnectSession(userId, sessionDir), 3000);
                        }

                        if (!resolved) {
                            resolved = true;
                            reject(new Error(`DESCONECTADO_${statusCode}`));
                        }
                    }
                });

                sock.ev.on('creds.update', saveCreds);

            } catch (error) {
                console.error(`❌ Erro ao reconectar ${userId}:`, error.message);
                reject(error);
            }
        });
    }

    /**
     * ✅ INICIA NOVA SESSÃO
     */
    async startSession(userId, method = 'qr', phoneNumber = null) {
        console.log(`\n${'='.repeat(50)}`);
        console.log('[MultiSessionBot] Nova conexão');
        console.log('User:', userId);
        console.log('Método:', method);
        console.log('Tel:', phoneNumber || 'N/A');
        console.log('='.repeat(50));

        // Limpa tentativas antigas
        const attempts = this.reconnectAttempts.get(userId) || 0;
        if (attempts > 3) {
            console.log('⚠️ Muitas tentativas. Limpando...');
            await this.disconnectSession(userId);
            await new Promise(resolve => setTimeout(resolve, 5000));
            this.reconnectAttempts.delete(userId);
        }

        // Limpa sessão existente
        if (this.sessions.has(userId)) {
            console.log('[MultiSessionBot] ⚠️ Sessão existente. Desconectando...');
            await this.disconnectSession(userId);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        const sessionDir = path.join(this.authDir, `session_${userId}`);
        
        // Remove arquivos antigos
        if (fs.existsSync(sessionDir)) {
            console.log('[MultiSessionBot] 🗑️ Removendo sessão antiga...');
            fs.rmSync(sessionDir, { recursive: true, force: true });
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        return new Promise(async (resolve, reject) => {
            try {
                fs.mkdirSync(sessionDir, { recursive: true });

                const { version } = await fetchLatestBaileysVersion();
                console.log('[MultiSessionBot] 📦 Baileys versão:', version.join('.'));

                const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

                // ✅ CONFIGURAÇÃO OTIMIZADA
                const sock = makeWASocket({
                    version,
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
                    },
                    logger: pino({ level: 'silent' }),
                    printQRInTerminal: false, // ✅ SEMPRE FALSE (fazemos manual)
                    browser: Browsers.macOS('MarkaÍ'),
                    generateHighQualityLinkPreview: true,
                    markOnlineOnConnect: false, // ✅ CRÍTICO
                    syncFullHistory: false,
                    connectTimeoutMs: 60000,
                    defaultQueryTimeoutMs: 60000,
                    keepAliveIntervalMs: 30000,
                    getMessage: async () => ({ conversation: '' })
                });

                this.sessionStates.set(userId, {
                    qr: null,
                    code: null,
                    number: null,
                    state: 'connecting'
                });

                let connectionTimeout;
                let resolved = false;

                // ⏱️ TIMEOUT DE 90 SEGUNDOS
                connectionTimeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        console.log('[MultiSessionBot] ⏰ Timeout de conexão');
                        this.cleanupSession(userId, sock);
                        reject(new Error('TIMEOUT'));
                    }
                }, 90000);

                // 🔥 EVENTO: Atualização de Conexão
                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;
                    
                    console.log('[MultiSessionBot] 🔄 Update:', { 
                        connection, 
                        qr: qr ? 'QR GERADO' : 'SEM QR',
                        reason: lastDisconnect?.error?.output?.statusCode 
                    });

                    // ✅ QR CODE GERADO
                    if (qr && method === 'qr') {
                        console.log('\n' + '='.repeat(50));
                        console.log('📱 QR CODE GERADO - ESCANEIE NO TERMINAL:');
                        console.log('='.repeat(50));
                        
                        // ✅ EXIBE NO TERMINAL
                        qrcode.generate(qr, { small: true });
                        
                        console.log('='.repeat(50));
                        console.log('⏳ Aguardando escanear...\n');

                        this.sessionStates.set(userId, {
                            ...this.sessionStates.get(userId),
                            qr,
                            state: 'qr_ready'
                        });

                        if (!resolved) {
                            resolved = true;
                            clearTimeout(connectionTimeout);
                            this.sessions.set(userId, sock);
                            resolve({ type: 'qr', data: qr });
                        }
                    }

                    // ✅ CONECTADO
                    if (connection === 'open') {
                        console.log('\n' + '✅'.repeat(25));
                        console.log('CONECTADO COM SUCESSO!');
                        console.log('✅'.repeat(25) + '\n');
                        
                        clearTimeout(connectionTimeout);
                        
                        const number = sock.user?.id?.split(':')[0] || phoneNumber?.replace(/\D/g, '');
                        
                        this.sessionStates.set(userId, {
                            qr: null,
                            code: null,
                            number,
                            state: 'active'
                        });

                        this.sessions.set(userId, sock);
                        this.reconnectAttempts.delete(userId);

                        // ✅ REGISTRA HANDLER DE MENSAGENS
                        sock.ev.on('messages.upsert', async ({ messages }) => {
                            for (const msg of messages) {
                                await handleIncomingMessage(msg, userId, sock);
                            }
                        });

                        if (!resolved) {
                            resolved = true;
                            resolve({ type: 'connected', number });
                        }
                    }

                    // ❌ DESCONECTADO
                    if (connection === 'close') {
                        clearTimeout(connectionTimeout);
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        
                        console.log('[MultiSessionBot] ❌ Desconectado:', statusCode);

                        // Erro 515 - Outro dispositivo
                        if (statusCode === DisconnectReason.connectionReplaced || statusCode === 440 || statusCode === 515) {
                            this.cleanupSession(userId, sock);
                            if (!resolved) {
                                resolved = true;
                                reject(new Error('ERRO_515_OUTRO_DISPOSITIVO'));
                            }
                            return;
                        }

                        // Erro 401 - Logout
                        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                            this.cleanupSession(userId, sock);
                            if (!resolved) {
                                resolved = true;
                                reject(new Error('LOGOUT'));
                            }
                            return;
                        }

                        // ✅ RECONEXÃO AUTOMÁTICA (outros erros)
                        if (statusCode === DisconnectReason.restartRequired || 
                            statusCode === DisconnectReason.connectionLost ||
                            statusCode === 428 || statusCode === 408) {
                            
                            const attempts = (this.reconnectAttempts.get(userId) || 0) + 1;
                            this.reconnectAttempts.set(userId, attempts);
                            
                            if (attempts <= 3) {
                                console.log(`🔄 Tentativa ${attempts}/3 de reconexão...`);
                                setTimeout(() => {
                                    this.reconnectSession(userId, sessionDir).catch(() => {});
                                }, 5000 * attempts);
                            }
                        }

                        if (!resolved) {
                            resolved = true;
                            reject(new Error('DESCONECTADO'));
                        }
                    }
                });

                // 💾 Salva credenciais
                sock.ev.on('creds.update', saveCreds);

                // 📝 MÉTODO: CÓDIGO DE PAREAMENTO
                if (method === 'code' && phoneNumber) {
                    console.log('[MultiSessionBot] 📲 Solicitando código para:', phoneNumber);
                    
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    try {
                        const cleanNumber = phoneNumber.replace(/\D/g, '');
                        const code = await sock.requestPairingCode(cleanNumber);
                        
                        console.log('\n' + '='.repeat(50));
                        console.log('🔑 CÓDIGO DE PAREAMENTO:');
                        console.log('='.repeat(50));
                        console.log(`\n   ${code}\n`);
                        console.log('='.repeat(50));
                        console.log('⏳ Cole este código no WhatsApp\n');

                        this.sessionStates.set(userId, {
                            ...this.sessionStates.get(userId),
                            code,
                            state: 'code_ready'
                        });

                        this.sessions.set(userId, sock);

                        if (!resolved) {
                            resolved = true;
                            clearTimeout(connectionTimeout);
                            resolve({ type: 'code', data: code, number: cleanNumber });
                        }
                    } catch (error) {
                        console.error('[MultiSessionBot] ❌ Erro ao gerar código:', error);
                        this.cleanupSession(userId, sock);
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(connectionTimeout);
                            reject(new Error('ERRO_CODIGO'));
                        }
                    }
                }

            } catch (error) {
                console.error('[MultiSessionBot] 💥 Erro fatal:', error);
                this.cleanupSession(userId);
                reject(error);
            }
        });
    }

    /**
     * ✅ DESCONECTA SESSÃO
     */
    async disconnectSession(userId) {
        console.log(`[MultiSessionBot] 🔌 Desconectando: ${userId}`);
        
        const sock = this.sessions.get(userId);
        
        if (sock) {
            try {
                await sock.logout();
            } catch (e) {
                try {
                    sock.end();
                } catch (e2) {}
            }
        }

        this.cleanupSession(userId, sock);
        return true;
    }

    /**
     * 🗑️ LIMPA SESSÃO
     */
    cleanupSession(userId, sock = null, removeFiles = true) {
        console.log(`[MultiSessionBot] 🗑️ Limpando sessão: ${userId}`);

        this.sessions.delete(userId);
        this.sessionStates.delete(userId);

        if (sock) {
            try {
                sock.end();
            } catch (e) {}
        }

        if (removeFiles) {
            const sessionDir = path.join(this.authDir, `session_${userId}`);
            if (fs.existsSync(sessionDir)) {
                try {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    console.log('[MultiSessionBot] ✅ Arquivos removidos');
                } catch (e) {
                    console.error('[MultiSessionBot] ❌ Erro ao remover:', e.message);
                }
            }
        }
    }

    /**
     * 📊 RETORNA STATUS
     */
    getStatus(userId) {
        const sock = this.sessions.get(userId);
        const state = this.sessionStates.get(userId);

        if (!sock || !state) {
            const sessionDir = path.join(this.authDir, `session_${userId}`);
            const credsPath = path.join(sessionDir, 'creds.json');
            
            if (fs.existsSync(credsPath)) {
                return {
                    connected: false,
                    state: 'saved_offline',
                    number: null,
                    qr: null,
                    message: 'Sessão salva. Restaurando...'
                };
            }

            return { 
                connected: false, 
                state: 'disconnected',
                number: null,
                qr: null
            };
        }

        return {
            connected: state.state === 'active',
            state: state.state,
            number: state.number,
            qr: state.qr
        };
    }

    /**
     * 🔌 RETORNA SOCKET
     */
    getSocket(userId) {
        return this.sessions.get(userId);
    }

    /**
     * 🧹 LIMPEZA FORÇADA
     */
    forceCleanAllSessions() {
        console.log('[MultiSessionBot] 🧹 LIMPEZA FORÇADA');
        
        let cleaned = 0;

        for (const [userId, sock] of this.sessions) {
            try {
                sock.end();
            } catch (e) {}
            cleaned++;
        }

        this.sessions.clear();
        this.sessionStates.clear();
        this.reconnectAttempts.clear();

        if (fs.existsSync(this.authDir)) {
            try {
                const files = fs.readdirSync(this.authDir);
                for (const file of files) {
                    const filePath = path.join(this.authDir, file);
                    fs.rmSync(filePath, { recursive: true, force: true });
                }
                console.log(`[MultiSessionBot] ✅ ${files.length} diretórios removidos`);
            } catch (e) {
                console.error('[MultiSessionBot] ❌ Erro na limpeza:', e.message);
            }
        }

        return cleaned;
    }
}

module.exports = new MultiSessionBot();