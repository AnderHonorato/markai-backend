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
const { handleIncomingMessage } = require('../bot');
const { Boom } = require('@hapi/boom');
const SessionPersistence = require('./SessionPersistence');

class MultiSessionBot {
    constructor() {
        this.sessions = new Map();
        this.sessionStates = new Map();
        this.authDir = path.join(__dirname, '../../auth_sessions');
        this.isConnecting = false;
        this.reconnectAttempts = new Map(); // Controla tentativas de reconexão
        
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }
        
        console.log('📱 MultiSessionBot inicializado - Com Restauração Automática');
    }

    /**
     * Método essencial para o bot.js conseguir enviar mensagens
     */
    getSocket(userId) {
        return this.sessions.get(userId);
    }

    async waitForConnectionSlot() {
        while (this.isConnecting) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        this.isConnecting = true;
    }

    releaseConnectionSlot() {
        this.isConnecting = false;
    }

    /**
     * 🔄 RESTAURA TODAS AS SESSÕES SALVAS
     */
    async restoreAllSessions() {
        console.log('\n🔄 INICIANDO RESTAURAÇÃO DE SESSÕES...');
        console.log('═'.repeat(50));
        
        try {
            // Limpa metadados órfãos primeiro
            SessionPersistence.cleanOrphanedMetadata();
            
            // Obtém sessões para restaurar
            const sessionsToRestore = SessionPersistence.getSessionsToRestore();
            
            if (sessionsToRestore.length === 0) {
                console.log('📂 Nenhuma sessão anterior encontrada para restaurar');
                console.log('═'.repeat(50));
                return { restored: 0, failed: 0 };
            }
            
            console.log(`📂 Encontradas ${sessionsToRestore.length} sessões para restaurar`);
            
            let restored = 0;
            let failed = 0;
            
            // Restaura cada sessão sequencialmente
            for (const sessionData of sessionsToRestore) {
                try {
                    console.log(`\n🔄 Restaurando: ${sessionData.userId}`);
                    console.log(`   📅 Última conexão: ${new Date(sessionData.lastConnected).toLocaleString('pt-BR')}`);
                    
                    // Tenta restaurar a sessão
                    await this.restoreSession(sessionData.userId);
                    
                    restored++;
                    console.log(`✅ Sessão ${sessionData.userId} restaurada com sucesso`);
                    
                    // Aguarda 3 segundos entre restaurações para não sobrecarregar
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                } catch (error) {
                    failed++;
                    console.error(`❌ Falha ao restaurar ${sessionData.userId}:`, error.message);
                    
                    // Se falhou por erro crítico, remove a sessão
                    if (error.message.includes('401') || error.message.includes('428')) {
                        console.log(`🗑️ Removendo sessão corrompida: ${sessionData.userId}`);
                        await this.forceCleanup(sessionData.userId);
                    }
                }
            }
            
            console.log('\n═'.repeat(50));
            console.log(`✅ RESTAURAÇÃO COMPLETA:`);
            console.log(`   ✓ Restauradas: ${restored}`);
            console.log(`   ✗ Falhas: ${failed}`);
            console.log(`   📊 Taxa de sucesso: ${Math.round((restored / sessionsToRestore.length) * 100)}%`);
            console.log('═'.repeat(50));
            
            return { restored, failed, total: sessionsToRestore.length };
            
        } catch (error) {
            console.error('❌ Erro fatal na restauração de sessões:', error);
            return { restored: 0, failed: 0, total: 0 };
        }
    }

    /**
     * 🔄 RESTAURA UMA SESSÃO ESPECÍFICA
     */
    async restoreSession(userId) {
        const sessionDir = path.join(this.authDir, `session_${userId}`);
        const credsFile = path.join(sessionDir, 'creds.json');
        
        // Verifica se tem credenciais
        if (!fs.existsSync(credsFile)) {
            throw new Error('CREDENCIAIS_AUSENTES');
        }
        
        // Verifica se já está conectada
        const existingSession = this.sessions.get(userId);
        if (existingSession) {
            console.log(`⚠️ Sessão ${userId} já está ativa, pulando restauração`);
            return;
        }
        
        // Cria a conexão usando as credenciais salvas
        return await this.createNewConnection(userId, 'restore', null, false);
    }

    async startSession(userId, method = 'qr', phoneNumber = null, isRetry = false) {
        if (!isRetry) {
            console.log(`\n[MultiSessionBot] 🔌 Iniciando sessão: ${userId}`);
            await this.waitForConnectionSlot();
            
            try {
                // Se não for retry, limpamos resquícios da memória antes de começar
                const existing = this.sessions.get(userId);
                if (existing) {
                    existing.end();
                    this.sessions.delete(userId);
                }

                return await this.createNewConnection(userId, method, phoneNumber);
            } finally {
                this.releaseConnectionSlot();
            }
        } else {
            return this.createNewConnection(userId, method, phoneNumber, true);
        }
    }

    async createNewConnection(userId, method, phoneNumber, isRetry = false) {
        return new Promise(async (resolve, reject) => {
            let resolved = false;
            const sessionDir = path.join(this.authDir, `session_${userId}`);

            try {
                if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

                const { version } = await fetchLatestBaileysVersion();
                const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

                const sock = makeWASocket({
                    version,
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
                    },
                    logger: pino({ level: 'silent' }),
                    browser: ['Ubuntu', 'Chrome', '20.0.04'],
                    markOnlineOnConnect: true,
                    connectTimeoutMs: 60000,
                    syncFullHistory: false,
                });

                if (!isRetry) {
                    this.sessionStates.set(userId, { state: 'connecting', qr: null, code: null });
                }

                sock.ev.on('creds.update', saveCreds);

                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr && method === 'qr' && !isRetry) {
                        this.sessionStates.set(userId, { ...this.sessionStates.get(userId), qr, state: 'qr_ready' });
                        if (!resolved) { resolved = true; resolve({ type: 'qr', data: qr }); }
                    }

                    if (connection === 'open') {
                        console.log(`[${userId}] ✅ CONECTADO`);
                        const number = sock.user?.id?.split(':')[0];
                        
                        // Atualiza estado na memória
                        this.sessionStates.set(userId, { state: 'active', number, qr: null, code: null });
                        this.sessions.set(userId, sock);
                        
                        // 💾 SALVA METADADOS DA SESSÃO
                        SessionPersistence.saveSessionMetadata(userId, {
                            phoneNumber: number,
                            status: 'active',
                            lastConnected: new Date().toISOString(),
                            connectionMethod: method === 'restore' ? 'restored' : method
                        });
                        
                        // Reseta contador de tentativas de reconexão
                        this.reconnectAttempts.delete(userId);
                        
                        if (!resolved) { resolved = true; resolve({ type: 'connected', number }); }
                    }

                    if (connection === 'close') {
                        const statusCode = (lastDisconnect?.error instanceof Boom) 
                            ? lastDisconnect.error.output?.statusCode 
                            : lastDisconnect?.error?.code;
                        
                        console.log(`[${userId}] 🔌 Conexão fechada: ${statusCode}`);

                        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                        if (shouldReconnect) {
                            // Controla tentativas de reconexão
                            const attempts = this.reconnectAttempts.get(userId) || 0;
                            
                            if (attempts >= 5) {
                                console.log(`[${userId}] ⚠️ Máximo de tentativas atingido (5), parando reconexões`);
                                await this.forceCleanup(userId);
                            } else {
                                // Se o erro for de descriptografia (428/440/Bad MAC), limpamos e pedimos novo login
                                if (statusCode === 428 || statusCode === 440) {
                                    console.log(`[${userId}] ⚠️ Erro crítico de chaves. Resetando sessão...`);
                                    await this.forceCleanup(userId);
                                } else {
                                    // Reconexão normal com delay progressivo
                                    this.reconnectAttempts.set(userId, attempts + 1);
                                    const delay = Math.min(10000 * (attempts + 1), 60000); // Máximo 60s
                                    
                                    console.log(`[${userId}] 🔄 Tentativa de reconexão ${attempts + 1}/5 em ${delay/1000}s...`);
                                    
                                    setTimeout(() => {
                                        this.startSession(userId, method, phoneNumber, true);
                                    }, delay);
                                }
                            }
                        } else {
                            console.log(`[${userId}] 🚪 Logout permanente detectado`);
                            await this.forceCleanup(userId);
                        }

                        if (!resolved) {
                            resolved = true;
                            reject(new Error(`DISCONNECTED_${statusCode}`));
                        }
                    }
                });

                sock.ev.on('messages.upsert', async ({ messages, type }) => {
                    if (type === 'notify') {
                        for (const msg of messages) {
                            if (!msg.key.fromMe) {
                                handleIncomingMessage(msg, userId, sock).catch(e => {
                                    console.error(`[${userId}] Erro no bot:`, e.message);
                                });
                            }
                        }
                    }
                });

                if (method === 'code' && phoneNumber && !isRetry) {
                    setTimeout(async () => {
                        try {
                            let cleanNumber = phoneNumber.replace(/\D/g, '');
                            const code = await sock.requestPairingCode(cleanNumber);
                            this.sessionStates.set(userId, { ...this.sessionStates.get(userId), code, state: 'code_ready' });
                            if (!resolved) { resolved = true; resolve({ type: 'code', data: code }); }
                        } catch (err) {
                            if (!resolved) { resolved = true; reject(err); }
                        }
                    }, 5000);
                }

            } catch (error) {
                if (!resolved) { resolved = true; reject(error); }
            }
        });
    }

    async forceCleanup(userId) {
        console.log(`[MultiSessionBot] 🧹 Limpando: ${userId}`);
        
        const sock = this.sessions.get(userId);
        if (sock) {
            try { sock.end(); } catch (e) {}
        }
        
        this.sessions.delete(userId);
        this.sessionStates.delete(userId);
        this.reconnectAttempts.delete(userId);
        
        // Remove metadados
        SessionPersistence.removeSessionMetadata(userId);
        
        // Remove arquivos
        const sessionDir = path.join(this.authDir, `session_${userId}`);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    }

    async forceCleanAllSessions() {
        console.log('\n[MultiSessionBot] 🔥 FAXINA GLOBAL');
        
        let count = 0;
        for (const [userId, sock] of this.sessions) {
            try { sock.end(); } catch (e) {}
            count++;
        }
        
        this.sessions.clear();
        this.sessionStates.clear();
        this.reconnectAttempts.clear();
        
        if (fs.existsSync(this.authDir)) {
            const files = fs.readdirSync(this.authDir);
            for (const file of files) {
                fs.rmSync(path.join(this.authDir, file), { recursive: true, force: true });
            }
        }
        
        return count;
    }

    getStatus(userId) {
        const state = this.sessionStates.get(userId);
        if (!state) return { connected: false, state: 'disconnected' };
        return { ...state, connected: state.state === 'active' };
    }

    async disconnectSession(userId) {
        await this.forceCleanup(userId);
        return true;
    }

    /**
     * 🏥 VERIFICAÇÃO DE SAÚDE DAS SESSÕES
     */
    async healthCheck() {
        const activeSessions = Array.from(this.sessions.keys());
        const results = {
            total: activeSessions.length,
            healthy: 0,
            unhealthy: 0,
            details: []
        };
        
        for (const userId of activeSessions) {
            const sock = this.sessions.get(userId);
            const state = this.sessionStates.get(userId);
            
            const isHealthy = sock && state && state.state === 'active';
            
            if (isHealthy) {
                results.healthy++;
            } else {
                results.unhealthy++;
                results.details.push({
                    userId,
                    issue: !sock ? 'socket_missing' : 'state_invalid'
                });
            }
        }
        
        return results;
    }
}

module.exports = new MultiSessionBot();