// backend/src/services/MultiSessionBot.js
const makeWASocket = require('@whiskeysockets/baileys').default;
const { 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

class MultiSessionBot {
    constructor() {
        this.sessions = new Map(); // userId -> socket
        this.sessionStates = new Map(); // userId -> { qr, code, number, state }
        this.authDir = path.join(__dirname, '../../auth_sessions');
        
        // Cria diretório de autenticação
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }
        
        console.log('📱 MultiSessionBot inicializado');
        console.log('📂 Diretório auth:', this.authDir);
        
        // 🔥 RESTAURA SESSÕES SALVAS AO INICIAR
        this.restoreSessions();
    }

    /**
     * ♻️ RESTAURA SESSÕES APÓS RESTART
     */
    async restoreSessions() {
        console.log('\n🔄 RESTAURANDO SESSÕES SALVAS...');
        
        try {
            if (!fs.existsSync(this.authDir)) {
                console.log('📂 Nenhuma sessão para restaurar');
                return;
            }

            const sessionDirs = fs.readdirSync(this.authDir).filter(dir => 
                dir.startsWith('session_') && fs.statSync(path.join(this.authDir, dir)).isDirectory()
            );

            console.log(`📂 Encontradas ${sessionDirs.length} sessões`);

            let restored = 0;

            for (const dirName of sessionDirs) {
                const userId = dirName.replace('session_', '');
                const sessionDir = path.join(this.authDir, dirName);
                
                // Verifica se tem credenciais válidas
                const credsPath = path.join(sessionDir, 'creds.json');
                if (!fs.existsSync(credsPath)) {
                    console.log(`⏭️ Pulando ${userId}: sem credenciais`);
                    continue;
                }

                try {
                    console.log(`🔌 Reconectando: ${userId}`);
                    await this.reconnectSession(userId, sessionDir);
                    restored++;
                } catch (error) {
                    console.error(`❌ Erro ao restaurar ${userId}:`, error.message);
                    // Não remove - pode ser temporário
                }
            }

            console.log(`✅ RESTAURAÇÃO COMPLETA: ${restored} sessões ativas\n`);
        } catch (error) {
            console.error('❌ Erro na restauração:', error);
        }
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
                    browser: ['Markaí Bot', 'Chrome', '1.0.0'],
                    generateHighQualityLinkPreview: true,
                    markOnlineOnConnect: true,
                    syncFullHistory: false,
                    getMessage: async () => ({ conversation: '' })
                });

                let resolved = false;

                // Timeout de 30 segundos para reconexão
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        reject(new Error('TIMEOUT_RECONEXAO'));
                    }
                }, 30000);

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

                        if (!resolved) {
                            resolved = true;
                            resolve();
                        }
                    }

                    if (connection === 'close') {
                        clearTimeout(timeout);
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        
                        // Se for logout, limpa a sessão
                        if (statusCode === 401 || statusCode === 440) {
                            console.log(`🗑️ Sessão inválida, limpando: ${userId}`);
                            this.cleanupSession(userId, sock);
                        }

                        if (!resolved) {
                            resolved = true;
                            reject(new Error(`DESCONECTADO_${statusCode}`));
                        }
                    }
                });

                sock.ev.on('creds.update', saveCreds);

            } catch (error) {
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

        // Limpa sessão existente
        if (this.sessions.has(userId)) {
            console.log('[MultiSessionBot] ⚠️ Sessão existente detectada. Limpando...');
            await this.disconnectSession(userId);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const sessionDir = path.join(this.authDir, `session_${userId}`);
        
        // Remove arquivos antigos de sessão
        if (fs.existsSync(sessionDir)) {
            console.log('[MultiSessionBot] 🗑️ Removendo sessão antiga...');
            fs.rmSync(sessionDir, { recursive: true, force: true });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return new Promise(async (resolve, reject) => {
            try {
                // Cria diretório da sessão
                fs.mkdirSync(sessionDir, { recursive: true });

                // Carrega versão do Baileys
                const { version } = await fetchLatestBaileysVersion();
                console.log('[MultiSessionBot] 📦 Baileys versão:', version.join('.'));

                // Carrega autenticação
                const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

                // Configuração do socket
                const sock = makeWASocket({
                    version,
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
                    },
                    logger: pino({ level: 'silent' }),
                    printQRInTerminal: false,
                    browser: ['Markaí Bot', 'Chrome', '1.0.0'],
                    generateHighQualityLinkPreview: true,
                    markOnlineOnConnect: true,
                    syncFullHistory: false,
                    getMessage: async () => ({ conversation: '' })
                });

                // Estado inicial
                this.sessionStates.set(userId, {
                    qr: null,
                    code: null,
                    number: null,
                    state: 'connecting'
                });

                let connectionTimeout;
                let resolved = false;

                // ⏱️ TIMEOUT DE 60 SEGUNDOS
                connectionTimeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        console.log('[MultiSessionBot] ⏰ Timeout de conexão');
                        this.cleanupSession(userId, sock);
                        reject(new Error('TIMEOUT'));
                    }
                }, 60000);

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
                        console.log('[MultiSessionBot] 📱 QR Code gerado');
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
                        console.log('[MultiSessionBot] ✅ CONECTADO!');
                        clearTimeout(connectionTimeout);
                        
                        // Pega número conectado
                        const number = sock.user?.id?.split(':')[0] || phoneNumber?.replace(/\D/g, '');
                        
                        this.sessionStates.set(userId, {
                            qr: null,
                            code: null,
                            number,
                            state: 'active'
                        });

                        this.sessions.set(userId, sock);

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

                        // Erro 515 - Outro dispositivo conectado
                        if (statusCode === 515) {
                            this.cleanupSession(userId, sock);
                            if (!resolved) {
                                resolved = true;
                                reject(new Error('ERRO_515_OUTRO_DISPOSITIVO'));
                            }
                            return;
                        }

                        // Erro 401 - Logout/Sessão inválida
                        if (statusCode === 401 || statusCode === 440) {
                            this.cleanupSession(userId, sock);
                            if (!resolved) {
                                resolved = true;
                                reject(new Error('LOGOUT'));
                            }
                            return;
                        }

                        // Outros erros - NÃO LIMPA (pode ser temporário)
                        if (!resolved) {
                            resolved = true;
                            reject(new Error('DESCONECTADO'));
                        }
                    }
                });

                // 💾 Salva credenciais (IMPORTANTE para persistência)
                sock.ev.on('creds.update', saveCreds);

                // 🔐 MÉTODO: CÓDIGO DE PAREAMENTO
                if (method === 'code' && phoneNumber) {
                    console.log('[MultiSessionBot] 📲 Solicitando código para:', phoneNumber);
                    
                    // Aguarda socket estar pronto
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    try {
                        const cleanNumber = phoneNumber.replace(/\D/g, '');
                        const code = await sock.requestPairingCode(cleanNumber);
                        
                        console.log('[MultiSessionBot] ✅ Código gerado:', code);

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
     * 🗑️ LIMPA SESSÃO (mas mantém arquivos se conectado)
     */
    cleanupSession(userId, sock = null, removeFiles = true) {
        console.log(`[MultiSessionBot] 🗑️ Limpando sessão: ${userId}`);

        // Remove do mapa
        this.sessions.delete(userId);
        this.sessionStates.delete(userId);

        // Encerra socket
        if (sock) {
            try {
                sock.end();
            } catch (e) {}
        }

        // Remove arquivos APENAS se logout ou erro grave
        if (removeFiles) {
            const sessionDir = path.join(this.authDir, `session_${userId}`);
            if (fs.existsSync(sessionDir)) {
                try {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    console.log('[MultiSessionBot] ✅ Arquivos removidos');
                } catch (e) {
                    console.error('[MultiSessionBot] ❌ Erro ao remover arquivos:', e.message);
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

        // Se não tem em memória, verifica se tem arquivos salvos
        if (!sock || !state) {
            const sessionDir = path.join(this.authDir, `session_${userId}`);
            const credsPath = path.join(sessionDir, 'creds.json');
            
            if (fs.existsSync(credsPath)) {
                // Tem sessão salva mas não em memória (servidor reiniciou)
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
        console.log('[MultiSessionBot] 🧹 LIMPEZA FORÇADA DE TODAS AS SESSÕES');
        
        let cleaned = 0;

        // Limpa memória
        for (const [userId, sock] of this.sessions) {
            try {
                sock.end();
            } catch (e) {}
            cleaned++;
        }

        this.sessions.clear();
        this.sessionStates.clear();

        // Remove TODOS os arquivos
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

// Exporta instância única (Singleton)
module.exports = new MultiSessionBot();