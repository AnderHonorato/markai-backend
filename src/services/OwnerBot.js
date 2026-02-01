// backend/src/services/OwnerBot.js
// ✅ VERSÃO CORRIGIDA - RECONEXÃO ROBUSTA COMO O MULTISESSIONBOT

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
const { handleOwnerIncomingMessage } = require('../bot-owner');
const { Boom } = require('@hapi/boom');
const { PrismaClient } = require('@prisma/client');
const ownerSessionPersistence = require('./OwnerSessionPersistence.service');
const { loadSavedStates } = require('./Owner.ai.service');
const autoMessageScheduler = require('./OwnerGroupScheduler.service');

const prisma = new PrismaClient();

const OWNER_EMAIL = 'contato.markaiapp@gmail.com';

class OwnerBot {
    constructor() {
        this.ownerSocket = null;
        this.ownerState = null;
        this.authDir = ownerSessionPersistence.getSessionPath();
        this.reconnectAttempts = 0; // ✅ CONTADOR DE TENTATIVAS
        this.isConnecting = false;
        this.connectionClosed = false;
        this.isRestoring = false;
        
        console.log('👑 OwnerBot inicializado');
        console.log('📁 Auth dir:', this.authDir);
    }

    getSocket() {
        return this.ownerSocket;
    }

    async isPaused() {
        try {
            const owner = await prisma.user.findFirst({
                where: { email: OWNER_EMAIL },
                select: { ownerBotPaused: true }
            });
            return owner?.ownerBotPaused || false;
        } catch (error) {
            console.error('[OwnerBot] Erro ao verificar pause:', error.message);
            return false;
        }
    }

    async updateLastActivity() {
        try {
            await prisma.user.updateMany({
                where: { email: OWNER_EMAIL },
                data: { ownerBotLastActivity: new Date() }
            });
            await ownerSessionPersistence.updateLastActivity();
        } catch (error) {
            console.error('[OwnerBot] Erro ao atualizar atividade:', error.message);
        }
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

    cleanPhoneNumber(phoneNumber) {
        if (!phoneNumber) return null;
        
        let cleaned = phoneNumber.replace(/\D/g, '');
        
        console.log('[OwnerBot] 🔢 Número original:', phoneNumber);
        console.log('[OwnerBot] 🔢 Número limpo:', cleaned);
        
        if (!cleaned.startsWith('55')) {
            cleaned = '55' + cleaned;
        }
        
        console.log('[OwnerBot] 🔢 Número com 55:', cleaned);
        
        if (cleaned.length < 12 || cleaned.length > 13) {
            throw new Error('NUMERO_INVALIDO');
        }
        
        console.log('[OwnerBot] ✅ Número formatado final:', cleaned);
        return cleaned;
    }

    async restoreSession() {
        if (this.isRestoring || this.ownerSocket) {
            console.log('[OwnerBot] ⏭️ Já está restaurando ou já conectado');
            return false;
        }

        try {
            this.isRestoring = true;
            
            const hasSession = ownerSessionPersistence.hasSession();
            
            if (!hasSession) {
                console.log('[OwnerBot] 📂 Nenhuma sessão salva encontrada');
                return false;
            }
            
            const metadata = ownerSessionPersistence.loadMetadata();
            
            if (!metadata || !metadata.connected) {
                console.log('[OwnerBot] ℹ️ Sessão existe mas não estava conectada');
                return false;
            }
            
            console.log('\n' + '👑'.repeat(35));
            console.log('[OwnerBot] 🔄 RESTAURANDO SESSÃO SALVA');
            console.log('[OwnerBot] Número:', metadata.number);
            console.log('[OwnerBot] Conectado em:', metadata.connectedAt);
            console.log('👑'.repeat(35) + '\n');
            
            loadSavedStates();
            
            const result = await this.createNewConnection('restore', null, false, true);
            
            if (result && result.type === 'connected') {
                console.log('[OwnerBot] ✅ Sessão restaurada com sucesso!');
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('[OwnerBot] ❌ Erro ao restaurar sessão:', error.message);
            return false;
        } finally {
            this.isRestoring = false;
        }
    }

    async startSession(arg1 = 'qr', arg2 = null, isRetry = false) {
        let method = 'qr';
        let phoneNumber = null;

        if (typeof arg1 === 'string' && arg1.length > 5) {
            phoneNumber = arg1;
            method = 'code';
        } else {
            method = arg1;
            phoneNumber = arg2;
        }

        if (!isRetry) {
            console.log(`\n${'='.repeat(70)}`);
            console.log(`[OwnerBot] 🔌 INICIANDO SESSÃO`);
            console.log(`[OwnerBot] Método: ${method}`);
            if (phoneNumber) console.log(`[OwnerBot] Telefone RECEBIDO: ${phoneNumber}`);
            console.log(`${'='.repeat(70)}\n`);
            
            await this.waitForConnectionSlot();
            
            try {
                if (this.ownerSocket) {
                    try { this.ownerSocket.end(); } catch (e) {}
                    this.ownerSocket = null;
                }
                
                this.connectionClosed = false;
                return await this.createNewConnection(method, phoneNumber);
            } finally {
                this.releaseConnectionSlot();
            }
        } else {
            return this.createNewConnection(method, phoneNumber, true);
        }
    }

    async createNewConnection(method, phoneNumber, isRetry = false, isRestore = false) {
        return new Promise(async (resolve, reject) => {
            let resolved = false;

            try {
                const { version } = await fetchLatestBaileysVersion();
                const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

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

                if (!isRetry && !isRestore) {
                    this.ownerState = { state: 'connecting', qr: null, code: null };
                }

                sock.ev.on('creds.update', saveCreds);

                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr && method === 'qr' && !isRetry && !isRestore) {
                        this.ownerState = { ...this.ownerState, qr, state: 'qr_ready' };
                        if (!resolved) { 
                            resolved = true; 
                            resolve({ type: 'qr', data: qr }); 
                        }
                    }

                    if (connection === 'open') {
                        const number = sock.user?.id?.split(':')[0];
                        console.log(`[OwnerBot] ✅ CONECTADO: +${number}`);
                        
                        this.ownerState = { state: 'active', number, qr: null, code: null };
                        this.ownerSocket = sock;
                        
                        await ownerSessionPersistence.saveMetadata({
                            connected: true,
                            number,
                            connectedAt: new Date().toISOString()
                        });
                        
                        await this.updateLastActivity();
                        
                        // ✅ CRÍTICO: RESETA O CONTADOR QUANDO CONECTA COM SUCESSO
                        this.reconnectAttempts = 0;
                        console.log('[OwnerBot] ✅ Contador de reconexão resetado');
                        
                        // Inicia scheduler
                        console.log('[OwnerBot] 📨 Registrando socket no scheduler...');
                        autoMessageScheduler.setSocket(sock);
                        await autoMessageScheduler.startAll();
                        
                        if (!resolved) { 
                            resolved = true; 
                            resolve({ type: 'connected', number }); 
                        }
                    }

                    if (connection === 'close') {
                        this.connectionClosed = true;
                        const statusCode = (lastDisconnect?.error instanceof Boom) 
                            ? lastDisconnect.error.output?.statusCode 
                            : lastDisconnect?.error?.code;
                        
                        console.log(`[OwnerBot] ❌ Conexão fechada: ${statusCode}`);
                        
                        // Para o scheduler
                        autoMessageScheduler.stopAll();

                        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                        // ✅ SISTEMA DE RECONEXÃO ROBUSTO (IGUAL AO MULTISESSIONBOT)
                        if (shouldReconnect && this.reconnectAttempts < 5) {
                            this.reconnectAttempts++;
                            const delay = Math.min(10000 * this.reconnectAttempts, 60000); // 10s → 20s → 30s → 40s → 60s
                            
                            console.log(`[OwnerBot] 🔄 Tentativa de reconexão ${this.reconnectAttempts}/5 em ${delay/1000}s...`);
                            
                            setTimeout(() => {
                                this.startSession(method, phoneNumber, true);
                            }, delay);
                            
                        } else if (this.reconnectAttempts >= 5) {
                            // ✅ MÁXIMO DE TENTATIVAS ATINGIDO
                            console.log('[OwnerBot] ⚠️ Máximo de tentativas (5) atingido, parando reconexões');
                            await this.forceCleanup();
                            
                        } else if (!shouldReconnect) {
                            // ✅ ERRO CRÍTICO (401, logout, etc)
                            console.log('[OwnerBot] 🚪 Logout permanente ou erro crítico detectado');
                            
                            // Se for erro de chaves (428/440), limpa tudo
                            if (statusCode === 428 || statusCode === 440) {
                                console.log('[OwnerBot] ⚠️ Erro de descriptografia detectado, limpando sessão...');
                            }
                            
                            await this.forceCleanup();
                        }

                        if (!resolved) {
                            resolved = true;
                            reject(new Error(`DISCONNECTED_${statusCode}`));
                        }
                    }
                });

                // Processa todas as mensagens (incluindo do bot)
                sock.ev.on('messages.upsert', async ({ messages, type }) => {
                    if (type === 'notify') {
                        if (await this.isPaused()) return;
                        await this.updateLastActivity();
                        for (const msg of messages) {
                            handleOwnerIncomingMessage(msg, 'OWNER', sock).catch(e => {
                                console.error('[OwnerBot] Erro no handler:', e.message);
                            });
                        }
                    }
                });

                if (method === 'code' && phoneNumber && !isRetry && !isRestore) {
                    setTimeout(async () => {
                        if (this.connectionClosed) return;
                        
                        try {
                            const cleanNumber = this.cleanPhoneNumber(phoneNumber);
                            
                            console.log('[OwnerBot] 🔑 Solicitando código para:', cleanNumber);
                            
                            const code = await sock.requestPairingCode(cleanNumber);
                            
                            this.ownerState = { ...this.ownerState, code, state: 'code_ready' };
                            console.log('[OwnerBot] ✅ CÓDIGO GERADO:', code);
                            
                            if (!resolved) { 
                                resolved = true; 
                                resolve({ type: 'code', data: code }); 
                            }
                        } catch (err) {
                            console.error('[OwnerBot] ❌ Erro ao gerar código:', err.message);
                            
                            if (err.message.includes('NUMERO_INVALIDO')) {
                                if (!resolved) { 
                                    resolved = true; 
                                    reject(new Error('Número inválido. Use formato: 55 + DDD + número (ex: 5577999512937)'));
                                }
                            } else {
                                if (!resolved) { resolved = true; reject(err); }
                            }
                        }
                    }, 5000);
                }

            } catch (error) {
                console.error('[OwnerBot] ❌ Erro fatal:', error.message);
                if (!resolved) { resolved = true; reject(error); }
            }
        });
    }

    async forceCleanup() {
        console.log('[OwnerBot] 🧹 Limpando tudo...');
        this.connectionClosed = true;
        
        // Para o scheduler
        autoMessageScheduler.stopAll();
        
        if (this.ownerSocket) {
            try { this.ownerSocket.end(); } catch (e) {}
        }
        
        this.ownerSocket = null;
        this.ownerState = null;
        
        // ✅ RESETA CONTADOR DE RECONEXÃO
        this.reconnectAttempts = 0;

        await ownerSessionPersistence.clearSession();
    }

    async getStatus() {
        let ownerData = null;
        try {
            ownerData = await prisma.user.findFirst({
                where: { email: OWNER_EMAIL },
                select: { 
                    ownerBotPaused: true, 
                    ownerBotConnectedAt: true, 
                    ownerBotLastActivity: true,
                    ownerBotRespondGroups: true
                }
            });
        } catch (e) {}
        
        return { 
            ...(this.ownerState || { state: 'disconnected' }),
            connected: this.ownerState?.state === 'active',
            paused: ownerData?.ownerBotPaused || false,
            respondGroups: ownerData?.ownerBotRespondGroups || false,
            reconnectAttempts: this.reconnectAttempts // ✅ EXPÕE CONTADOR NO STATUS
        };
    }

    async disconnectSession() {
        if (this.ownerSocket) {
            try { await this.ownerSocket.logout(); } catch (e) {}
        }
        await this.forceCleanup();
        return true;
    }
}

module.exports = new OwnerBot();