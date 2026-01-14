const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

// Tenta importar o bot, se falhar (erro de sintaxe), não derruba o app
let handleIncomingMessage;
try {
    const botModule = require('../bot');
    handleIncomingMessage = botModule.handleIncomingMessage;
} catch (error) {
    console.warn("⚠️ Aviso: bot.js não carregado.", error.message);
    handleIncomingMessage = async () => {};
}

const sessions = new Map();

const startSession = async (userId, method, phoneNumber = null) => {
    // 1. Limpeza e Preparação
    const authPath = path.resolve(__dirname, `../../auth_sessions/session_${userId}`);
    if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    // 2. Criação do Cliente (Socket)
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // QR será via API
        logger: pino({ level: 'silent' }),
        browser: ["Markai", "Chrome", "120.0.0"], // Identificação
        syncFullHistory: false, // Importante para não travar
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        markOnlineOnConnect: true
    });

    sessions.set(userId, sock);

    // 3. Eventos Globais (Rodam sempre)
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
            for (const msg of messages) {
                await handleIncomingMessage(msg, userId, sock);
            }
        }
    });

    // 4. Promise de Controle (Retorna o QR ou o Código para o Frontend)
    return new Promise(async (resolve, reject) => {
        
        // --- Listener de Conexão Unificado ---
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // A) SE PEDIU QR CODE
            if (qr && method === 'qr') {
                resolve({ type: 'qr', data: qr });
            }

            // B) CONEXÃO FECHADA
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`[Sessão ${userId}] Conexão fechada. Reconectar? ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    startSession(userId, 'reconnect'); // Reconexão automática
                } else {
                    sessions.delete(userId); // Logout real
                    try { fs.rmSync(authPath, { recursive: true, force: true }); } catch(e){}
                }
            } 
            
            // C) CONEXÃO ABERTA (SUCESSO)
            if (connection === 'open') {
                console.log(`[Sessão ${userId}] ✅ CONECTADO!`);
                // Se a promise ainda não foi resolvida (ex: reconexão automática), resolve agora
                resolve({ type: 'connected', data: 'CONNECTED' });
            }
        });

        // --- LÓGICA ESPECÍFICA DO PAIRING CODE ---
        if (method === 'code' && phoneNumber) {
            try {
                // Aguarda o socket estar pronto para receber comandos
                await delay(3000); 

                // Só pedimos código se NÃO estiver conectado ainda
                if (!sock.authState.creds.registered) {
                    console.log(`[Sessão ${userId}] Solicitando código para ${phoneNumber}...`);
                    
                    // Pede o código ao WhatsApp
                    const code = await sock.requestPairingCode(phoneNumber);
                    
                    console.log(`[Sessão ${userId}] Código gerado: ${code}`);
                    
                    // AQUI ESTÁ O SEGREDO: 
                    // Resolvemos a Promise AGORA para o Frontend mostrar o código na tela.
                    // O socket continua rodando em background esperando você digitar no celular.
                    resolve({ type: 'code', data: code });
                } else {
                    console.log(`[Sessão ${userId}] Já está conectado.`);
                    resolve({ type: 'connected', data: 'CONNECTED' });
                }
            } catch (err) {
                console.error(`[Sessão ${userId}] Erro ao gerar código:`, err);
                reject(new Error("Não foi possível gerar o código. Verifique se o número está correto (DDD+Número)."));
            }
        }
    });
};

const disconnectSession = async (userId) => {
    try {
        const sock = sessions.get(userId);
        const authPath = path.resolve(__dirname, `../../auth_sessions/session_${userId}`);
        
        if (sock) {
            try { await sock.logout(); } catch(e) {}
            try { sock.end(undefined); } catch(e) {}
            sessions.delete(userId);
        }
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
        return true;
    } catch (error) { return false; }
};

const getStatus = (userId) => {
    const sock = sessions.get(userId);
    if (sock && sock.user) return { connected: true, number: sock.user.id.split(':')[0] };
    const authPath = path.resolve(__dirname, `../../auth_sessions/session_${userId}`);
    if (fs.existsSync(authPath)) return { connected: true, number: 'Ativo' }; 
    return { connected: false, number: null };
};

module.exports = { startSession, getSession: (id) => sessions.get(id), disconnectSession, getStatus };