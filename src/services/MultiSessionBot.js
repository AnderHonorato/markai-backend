// backend/src/services/MultiSessionBot.js
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const { handleIncomingMessage } = require('../bot');

const BASE_AUTH_DIR = path.join(__dirname, '../../auth_sessions');

if (!fs.existsSync(BASE_AUTH_DIR)) {
    fs.mkdirSync(BASE_AUTH_DIR, { recursive: true });
}

class MultiSessionBot {
    constructor() {
        this.sessions = new Map();
        this.pendingConnections = new Map();
        this.error515Tracker = new Map();
        
        // ✅ RESTAURA SESSÕES AO INICIAR
        this.restaurarSessoes();
    }

    /**
     * ✅ CRIA LOGGER COMPATÍVEL COM BAILEYS
     */
    createLogger() {
        const logger = {
            level: 'silent',
            fatal: () => {},
            error: () => {},
            warn: () => {},
            info: () => {},
            debug: () => {},
            trace: () => {},
            child: () => logger
        };
        return logger;
    }

    /**
     * ✅ RESTAURA TODAS AS SESSÕES SALVAS
     */
    async restaurarSessoes() {
        console.log('\n🔄 RESTAURANDO SESSÕES SALVAS...\n');
        
        try {
            if (!fs.existsSync(BASE_AUTH_DIR)) {
                console.log('📁 Nenhuma sessão para restaurar');
                return;
            }

            const pastas = fs.readdirSync(BASE_AUTH_DIR);
            console.log(`📂 Encontradas ${pastas.length} sessões`);

            for (const pasta of pastas) {
                const sessionId = pasta; // Mantém "session_UUID"
                const authPath = path.join(BASE_AUTH_DIR, pasta);
                
                // Verifica se tem arquivo creds.json (sessão válida)
                const credsPath = path.join(authPath, 'creds.json');
                if (!fs.existsSync(credsPath)) {
                    console.log(`⏭️  Sessão ${sessionId} sem creds, pulando`);
                    continue;
                }

                try {
                    console.log(`🔌 Conectando sessão: ${sessionId}`);
                    await this.reconectarSessao(sessionId, authPath);
                    
                    // Aguarda 2 segundos entre conexões
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    console.error(`❌ Erro ao restaurar ${sessionId}:`, error.message);
                }
            }

            console.log(`\n✅ RESTAURAÇÃO COMPLETA: ${this.sessions.size} sessões ativas\n`);
        } catch (error) {
            console.error('❌ Erro na restauração:', error);
        }
    }

    /**
     * ✅ RECONECTA UMA SESSÃO SALVA
     */
    async reconectarSessao(sessionId, authPath) {
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // Já que você capturou o aviso de depreciado
            mobile: false, // Garanta que está false para pairing code
            browser: ["Markai App", "Chrome", "1.0.0"], // Identificação correta
            connectTimeoutMs: 60000, // Aumente para 60 segundos por causa do Render
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
        });

        // Listener de credenciais
        sock.ev.on('creds.update', saveCreds);

        // Listener de conexão
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom) && 
                    lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;

                if (shouldReconnect) {
                    console.log(`🔄 Reconectando ${sessionId}...`);
                    setTimeout(() => this.reconectarSessao(sessionId, authPath), 3000);
                } else {
                    console.log(`🚪 Sessão ${sessionId} desconectada permanentemente`);
                    this.sessions.delete(sessionId);
                }
            }

            if (connection === 'open') {
                console.log(`✅ Sessão ${sessionId} restaurada!`);
                this.sessions.set(sessionId, sock);
            }
        });

        // ✅ EXTRAI UUID LIMPO PARA PASSAR AO BOT
        const cleanUserId = sessionId.startsWith('session_') ? sessionId.replace('session_', '') : sessionId;
        
        // Listener de mensagens
        sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const msg of messages) {
                await handleIncomingMessage(msg, cleanUserId, sock);
            }
        });

        return sock;
    }

    async startSession(userId, method = 'qr', phoneNumber = null) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`[MultiSessionBot] Nova conexão`);
        console.log(`User: ${userId}`);
        console.log(`Método: ${method}`);
        console.log(`Tel: ${phoneNumber || 'N/A'}`);
        console.log(`${'='.repeat(50)}\n`);

        // Remove prefixo "session_" se existir para ter o UUID limpo
        const cleanUserId = userId.startsWith('session_') ? userId.replace('session_', '') : userId;
        const sessionId = `session_${cleanUserId}`;
        
        console.log(`[MultiSessionBot] UUID limpo: ${cleanUserId}`);
        console.log(`[MultiSessionBot] SessionId: ${sessionId}`);

        if (this.sessions.has(sessionId)) {
            const sock = this.sessions.get(sessionId);
            try {
                const number = sock.user?.id?.split(':')[0];
                console.log(`[MultiSessionBot] ✅ Já conectado: ${number}`);
                return { type: 'connected', message: 'Já conectado', number };
            } catch (e) {
                console.log(`[MultiSessionBot] ⚠️ Sessão inválida, limpando...`);
                this.sessions.delete(sessionId);
            }
        }

        // Verifica erro 515 persistente
        const error515Count = this.error515Tracker.get(sessionId) || 0;
        if (error515Count >= 3) {
            const lastError = this.error515Tracker.get(`${sessionId}_lastError`) || Date.now();
            const tempoDecorrido = Date.now() - lastError;
            
            if (tempoDecorrido < 120000) { // 2 minutos
                throw new Error('BLOQUEIO_TEMPORARIO');
            } else {
                this.error515Tracker.delete(sessionId);
                this.error515Tracker.delete(`${sessionId}_lastError`);
            }
        }

        const authPath = path.join(BASE_AUTH_DIR, sessionId);
        if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: method === 'qr',
            connectTimeoutMs: 60000,
            qrTimeout: 60000,
            logger: this.createLogger()
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                sock.end();
                this.pendingConnections.delete(sessionId);
                reject(new Error('TIMEOUT'));
            }, 60000);

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                console.log(`[MultiSessionBot] Status: ${connection}`);

                if (qr && method === 'qr' && !this.pendingConnections.has(sessionId)) {
                    this.pendingConnections.set(sessionId, true);
                    console.log('[MultiSessionBot] 📱 QR Code gerado');
                    resolve({ type: 'qr', data: qr });
                }

                if (connection === 'close') {
                    clearTimeout(timeout);
                    const statusCode = (lastDisconnect?.error instanceof Boom) 
                        ? lastDisconnect.error.output.statusCode 
                        : 500;

                    console.log(`[MultiSessionBot] ❌ Desconectado: ${statusCode}`);

                    // Tratamento erro 515
                    if (statusCode === 515) {
                        const currentCount = (this.error515Tracker.get(sessionId) || 0) + 1;
                        this.error515Tracker.set(sessionId, currentCount);
                        this.error515Tracker.set(`${sessionId}_lastError`, Date.now());
                        
                        console.log(`[MultiSessionBot] ⚠️ ERRO 515 (tentativa ${currentCount}/3)`);
                        
                        this.limparSessao(sessionId);
                        this.sessions.delete(sessionId);
                        this.pendingConnections.delete(sessionId);
                        
                        reject(new Error(`ERRO_515_PERSISTENTE_${currentCount}`));
                        return;
                    }

                    this.sessions.delete(sessionId);
                    this.pendingConnections.delete(sessionId);

                    if (statusCode === DisconnectReason.loggedOut) {
                        this.limparSessao(sessionId);
                        reject(new Error('LOGOUT'));
                    } else if (statusCode === 401) {
                        reject(new Error('CODIGO_EXPIRADO'));
                    } else {
                        reject(new Error(`DISCONNECT_${statusCode}`));
                    }
                }

                if (connection === 'open') {
                    clearTimeout(timeout);
                    
                    // Limpa contador de erro 515
                    this.error515Tracker.delete(sessionId);
                    this.error515Tracker.delete(`${sessionId}_lastError`);
                    
                    const number = sock.user.id.split(':')[0];
                    console.log(`[MultiSessionBot] ✅ CONECTADO: ${number}`);
                    
                    this.sessions.set(sessionId, sock);
                    this.pendingConnections.delete(sessionId);
                    
                    resolve({ type: 'connected', message: 'Sucesso', number });
                }
            });

            // ✅ PASSA cleanUserId (UUID puro) para o bot
            sock.ev.on('messages.upsert', async ({ messages }) => {
                for (const msg of messages) {
                    await handleIncomingMessage(msg, cleanUserId, sock);
                }
            });

            if (method === 'code' && phoneNumber) {
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        console.log(`[MultiSessionBot] 🔑 Código: ${code}`);
                        resolve({ type: 'code', data: code, number: phoneNumber });
                    } catch (error) {
                        clearTimeout(timeout);
                        reject(new Error('FALHA_CODIGO'));
                    }
                }, 3000);
            }
        });
    }

    async disconnectSession(userId) {
        // Normaliza para sessionId
        const sessionId = userId.startsWith('session_') ? userId : `session_${userId}`;
        
        const sock = this.sessions.get(sessionId);
        if (sock) {
            try {
                await sock.logout();
            } catch (e) {}
            sock.end();
            this.sessions.delete(sessionId);
            this.limparSessao(sessionId);
            return true;
        }
        return false;
    }

    getStatus(userId) {
        // Normaliza para sessionId
        const sessionId = userId.startsWith('session_') ? userId : `session_${userId}`;
        
        const sock = this.sessions.get(sessionId);
        if (sock) {
            try {
                const number = sock.user?.id?.split(':')[0];
                return { 
                    connected: true, 
                    state: 'active',
                    number 
                };
            } catch (e) {
                return { connected: false, state: 'disconnected', number: null };
            }
        }
        return { connected: false, state: 'disconnected', number: null };
    }

    /**
     * ✅ RETORNA O SOCKET PARA ENVIAR MENSAGENS
     */
    getSocket(userId) {
        const sessionId = userId.startsWith('session_') ? userId : `session_${userId}`;
        const sock = this.sessions.get(sessionId);
        
        if (!sock) {
            console.log(`[MultiSessionBot] ❌ Socket não encontrado para: ${sessionId}`);
            return null;
        }
        
        try {
            // Verifica se está conectado
            if (!sock.user) {
                console.log(`[MultiSessionBot] ⚠️ Socket existe mas não está conectado`);
                return null;
            }
            
            return sock;
        } catch (e) {
            console.log(`[MultiSessionBot] ❌ Erro ao acessar socket:`, e.message);
            return null;
        }
    }

    limparSessao(sessionId) {
        // Garante que usa sessionId com prefixo
        const normalizedId = sessionId.startsWith('session_') ? sessionId : `session_${sessionId}`;
        
        const authPath = path.join(BASE_AUTH_DIR, normalizedId);
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log(`[MultiSessionBot] 🗑️ Sessão ${normalizedId} limpa`);
        }
    }

    forceCleanAllSessions() {
        let cleaned = 0;
        if (fs.existsSync(BASE_AUTH_DIR)) {
            const pastas = fs.readdirSync(BASE_AUTH_DIR);
            for (const pasta of pastas) {
                const fullPath = path.join(BASE_AUTH_DIR, pasta);
                fs.rmSync(fullPath, { recursive: true, force: true });
                cleaned++;
            }
        }
        this.sessions.clear();
        this.pendingConnections.clear();
        this.error515Tracker.clear();
        return cleaned;
    }
}

module.exports = new MultiSessionBot();