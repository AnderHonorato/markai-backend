// backend/src/services/Owner.ai.service.js
// ✅ VERSÃO FINAL - COM DOWNLOADS + IA + RETRY DE ENVIO + SOCKET ATUAL

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const ownerSessionPersistence = require('./OwnerSessionPersistence.service');
const { 
    detectMediaRequest,
    generateImage,
    downloadAudio,
    downloadInstagram,
    downloadTikTok,
    downloadYouTubeVideo,
    generateAttpSticker,
    createImageSticker,
    convertWebpToGif
} = require('./SpiderXMedia.service');

const prisma = new PrismaClient();

require('dotenv').config();

const SPIDER_API_TOKEN = process.env.SPIDER_API_TOKEN;
const SPIDER_API_BASE_URL = 'https://api.spiderx.com.br/api/ai';
const OWNER_EMAIL = 'contato.markaiapp@gmail.com';

// ✅ ESTADOS DE CONVERSAÇÃO (PERSISTENTES)
let conversationStates = {};
let humanModeActive = {};
let blockedUsers = {};

const HUMAN_MODE_TIMEOUT = 30 * 60 * 1000;

// Sistema de debounce
const messageQueue = {};
const responseTimers = {};
const typingIntervals = {};

const DEBOUNCE_TIME = 10000;
const TYPING_INTERVAL = 5000;

// Controle de repetição
const repetitionControl = {};
const REPETITION_THRESHOLD = 3;
const IGNORE_DURATION = 30 * 60 * 1000;

function loadSavedStates() {
    try {
        const savedState = ownerSessionPersistence.loadConversationState();
        if (savedState) {
            conversationStates = savedState.conversationStates || {};
            humanModeActive = savedState.humanModeActive || {};
            blockedUsers = savedState.blockedUsers || {};
            console.log('[OWNER AI] 📖 Estados carregados da persistência');
            console.log(`   - ${Object.keys(conversationStates).length} conversas`);
            console.log(`   - ${Object.keys(humanModeActive).length} em modo humano`);
            console.log(`   - ${Object.keys(blockedUsers).length} bloqueados`);
        }
    } catch (error) {
        console.error('[OWNER AI] ❌ Erro ao carregar estados:', error.message);
    }
}

function saveStates() {
    try {
        ownerSessionPersistence.saveConversationState({
            conversationStates,
            humanModeActive,
            blockedUsers,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[OWNER AI] ❌ Erro ao salvar estados:', error.message);
    }
}

setInterval(saveStates, 30000);
loadSavedStates();

async function isBotPaused() {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL },
            select: { ownerBotPaused: true }
        });
        return owner?.ownerBotPaused || false;
    } catch (error) {
        console.error('[OWNER AI] Erro ao verificar pause:', error.message);
        return false;
    }
}

async function shouldRespondToGroups() {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL },
            select: { ownerBotRespondGroups: true }
        });
        return owner?.ownerBotRespondGroups || false;
    } catch (error) {
        console.error('[OWNER AI] Erro ao verificar grupos:', error.message);
        return false;
    }
}

async function updateLastActivity() {
    try {
        await prisma.user.updateMany({
            where: { email: OWNER_EMAIL },
            data: { ownerBotLastActivity: new Date() }
        });
        await ownerSessionPersistence.updateLastActivity();
    } catch (error) {
        console.error('[OWNER AI] Erro ao atualizar atividade:', error.message);
    }
}

function isUserBlocked(phoneNumber) {
    return blockedUsers[phoneNumber]?.blocked || false;
}

function blockUser(phoneNumber) {
    blockedUsers[phoneNumber] = {
        blocked: true,
        timestamp: Date.now()
    };
    saveStates();
    console.log(`[OWNER AI] 🚫 Usuário bloqueado: ${phoneNumber}`);
}

function unblockUser(phoneNumber) {
    delete blockedUsers[phoneNumber];
    if (humanModeActive[phoneNumber]) {
        delete humanModeActive[phoneNumber];
    }
    saveStates();
    console.log(`[OWNER AI] ✅ Usuário desbloqueado: ${phoneNumber}`);
    console.log(`[OWNER AI] 🤖 Modo humano desativado: ${phoneNumber}`);
}

function isHumanModeActive(phoneNumber) {
    const humanState = humanModeActive[phoneNumber];
    if (!humanState || !humanState.active) return false;
    
    const elapsed = Date.now() - humanState.lastMessage;
    if (elapsed > HUMAN_MODE_TIMEOUT) {
        delete humanModeActive[phoneNumber];
        saveStates();
        return false;
    }
    return true;
}

function activateHumanMode(phoneNumber) {
    humanModeActive[phoneNumber] = {
        active: true,
        lastMessage: Date.now()
    };
    saveStates();
    console.log(`[OWNER AI] 👤 Modo humano ativado para: ${phoneNumber}`);
}

function updateHumanModeTimestamp(phoneNumber) {
    if (humanModeActive[phoneNumber]) {
        humanModeActive[phoneNumber].lastMessage = Date.now();
        saveStates();
    }
}

function deactivateHumanMode(phoneNumber) {
    delete humanModeActive[phoneNumber];
    saveStates();
    console.log(`[OWNER AI] 🤖 Modo humano desativado para: ${phoneNumber}`);
}

function detectRepetition(message, phoneNumber) {
    const msgLower = message.toLowerCase().trim();
    
    if (!repetitionControl[phoneNumber]) {
        repetitionControl[phoneNumber] = {
            lastMessage: msgLower,
            count: 1,
            ignoredUntil: null
        };
        return false;
    }
    
    const control = repetitionControl[phoneNumber];
    
    if (control.ignoredUntil && Date.now() < control.ignoredUntil) {
        return true;
    }
    
    if (control.lastMessage !== msgLower) {
        control.lastMessage = msgLower;
        control.count = 1;
        control.ignoredUntil = null;
        return false;
    }
    
    control.count++;
    
    if (control.count >= REPETITION_THRESHOLD) {
        control.ignoredUntil = Date.now() + IGNORE_DURATION;
        console.log(`[OWNER AI] 🚫 Cliente ${phoneNumber} repetindo - ignorado por 30min`);
        return true;
    }
    
    return false;
}

function resetIgnoreIfKeyword(message, phoneNumber) {
    const msgLower = message.toLowerCase().trim();
    
    if (msgLower === 'falar com a assistente' || 
        msgLower === 'falar com assistente' ||
        msgLower === 'falar com bot' ||
        msgLower === 'falar com o bot' ||
        msgLower === 'falar com a ia' ||
        msgLower === 'falar com ia') {
        if (repetitionControl[phoneNumber]) {
            repetitionControl[phoneNumber].ignoredUntil = null;
            repetitionControl[phoneNumber].count = 0;
            console.log(`[OWNER AI] 🔓 Cliente ${phoneNumber} desbloqueado`);
            return true;
        }
    }
    return false;
}

function detectRejectIntent(message) {
    const msgLower = message.toLowerCase().trim();
    const rejectKeywords = [
        'não quero falar com você',
        'nao quero falar com voce',
        'não quero falar contigo',
        'para de responder',
        'cala a boca',
        'me deixa em paz',
        'não me responda',
        'nao me responda',
        'para de me mandar mensagem',
        'não quero conversar',
        'nao quero conversar',
        'chega de mensagem',
        'desliga essa ia',
        'desativa essa ia'
    ];
    return rejectKeywords.some(keyword => msgLower.includes(keyword));
}

function detectHumanIntent(message) {
    const msgLower = message.toLowerCase().trim();
    const humanKeywords = [
        'falar com ander',
        'falar com o ander',
        'falar com dono',
        'falar com o dono',
        'falar com humano',
        'falar com atendente',
        'falar com pessoa',
        'quero falar com',
        'preciso falar com',
        'transferir atendimento',
        'atendimento humano',
        'suporte humano'
    ];
    return humanKeywords.some(keyword => msgLower.includes(keyword));
}

function detectAIIntent(message) {
    const msgLower = message.toLowerCase().trim();
    const aiKeywords = [
        'falar com a ia',
        'falar com ia',
        'falar com bot',
        'falar com o bot',
        'falar com robo',
        'falar com robô',
        'voltar ia',
        'voltar bot',
        'falar com assistente',
        'falar com a assistente',
        'ativar ia',
        'ativar bot'
    ];
    return aiKeywords.some(keyword => msgLower === keyword || msgLower.includes(' ' + keyword));
}

function processOwnerMessage(phoneNumber) {
    activateHumanMode(phoneNumber);
}

// ✅ FUNÇÃO DE RETRY PARA ENVIO DE MENSAGENS (MAIS AGRESSIVO)
async function enviarComRetry(funcaoEnvio, maxTentativas = 5) {
    let ultimoErro = null;
    
    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
        try {
            console.log(`[OWNER AI RETRY] 📤 Tentativa ${tentativa}/${maxTentativas} de envio`);
            await funcaoEnvio();
            console.log(`[OWNER AI RETRY] ✅ Mensagem enviada com sucesso na tentativa ${tentativa}`);
            return true;
        } catch (error) {
            ultimoErro = error;
            console.error(`[OWNER AI RETRY] ❌ Tentativa ${tentativa} falhou:`, error.message);
            
            // Se não for a última tentativa, aguarda antes de tentar novamente
            if (tentativa < maxTentativas) {
                const delay = 2000 * tentativa; // 2s, 4s, 6s, 8s, 10s
                console.log(`[OWNER AI RETRY] ⏳ Aguardando ${delay}ms antes da próxima tentativa...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    console.error(`[OWNER AI RETRY] ❌ Todas as ${maxTentativas} tentativas falharam`);
    console.error(`[OWNER AI RETRY] Último erro:`, ultimoErro?.message);
    return false;
}

/**
 * ✅ PROCESSA MENSAGEM COM DEBOUNCE + DOWNLOADS + SOCKET ATUAL
 */
async function processarMensagemComDebounce(
    message, 
    phoneNumber, 
    ownerSock, // ✅ IGNORADO - não será usado
    enviarDigitando, 
    enviarResposta, 
    isGroup = false, 
    isMentioned = false,
    messageKey = null,
    messageObj = null
) {
    const clientId = phoneNumber || 'unknown';
    const msgLower = message.toLowerCase().trim();
    
    // ✅ FUNÇÃO PARA PEGAR SOCKET ATUAL
    const OwnerBot = require('./OwnerBot');
    const getSock = () => OwnerBot.getSocket();
    
    // ✅ PRIORIDADE 1: DETECTA REQUISIÇÕES DE MÍDIA **ANTES DE TUDO**
    const mediaRequest = detectMediaRequest(message);
    
    if (mediaRequest) {
        console.log('[OWNER AI] 🎯 Requisição de mídia detectada:', mediaRequest.type);
        
        try {
            const currentSock = getSock();
            if (!currentSock) {
                console.error('[OWNER AI] ❌ Socket não disponível para mídia');
                if (enviarResposta) {
                    await enviarResposta('❌ Bot temporariamente indisponível. Tente novamente.', messageKey);
                }
                return;
            }
            
            if (mediaRequest.type === 'instagram') {
                if (enviarResposta) await enviarResposta('📸 Baixando do Instagram...', messageKey);
                const result = await downloadInstagram(mediaRequest.url);
                
                if (result.success) {
                    await currentSock.sendMessage(clientId, {
                        video: { url: result.videoUrl },
                        caption: `✅ *Download concluído!*\n\n${result.title}`
                    });
                } else if (enviarResposta) {
                    await enviarResposta(`❌ ${result.error}`, messageKey);
                }
                return;
            }
            
            if (mediaRequest.type === 'tiktok') {
                if (enviarResposta) await enviarResposta('🎵 Baixando do TikTok...', messageKey);
                const result = await downloadTikTok(mediaRequest.url);
                
                if (result.success) {
                    await currentSock.sendMessage(clientId, {
                        video: { url: result.videoUrl },
                        caption: '✅ *Download do TikTok concluído!*'
                    });
                } else if (enviarResposta) {
                    await enviarResposta(`❌ ${result.error}`, messageKey);
                }
                return;
            }
            
            if (mediaRequest.type === 'youtube_video') {
                if (enviarResposta) await enviarResposta('🎬 Baixando vídeo do YouTube...\n\n⏳ Pode demorar alguns minutos.', messageKey);
                const result = await downloadYouTubeVideo(mediaRequest.url);
                
                if (result.success) {
                    if (enviarResposta) {
                        await enviarResposta(`✅ *${result.title}*\n\n📺 Canal: ${result.channel?.name || 'N/A'}\n\n📥 Enviando vídeo...`, messageKey);
                    }
                    
                    await currentSock.sendMessage(clientId, {
                        video: { url: result.videoUrl },
                        caption: `📹 ${result.title}`
                    });
                } else if (enviarResposta) {
                    await enviarResposta(`❌ ${result.error}`, messageKey);
                }
                return;
            }
            
            if (mediaRequest.type === 'audio') {
                if (enviarResposta) await enviarResposta('🎵 Procurando música...', messageKey);
                const result = await downloadAudio(mediaRequest.search);
                
                if (result.success) {
                    if (enviarResposta) {
                        await enviarResposta(`✅ *${result.title}*\n\n👤 Canal: ${result.channel}\n⏱️ Duração: ${Math.floor(result.duration / 60)}:${(result.duration % 60).toString().padStart(2, '0')}\n\n📥 Baixando áudio...`, messageKey);
                    }
                    
                    await currentSock.sendMessage(clientId, {
                        audio: { url: result.audioUrl },
                        mimetype: 'audio/mp4'
                    });
                } else if (enviarResposta) {
                    await enviarResposta(`❌ ${result.error}`, messageKey);
                }
                return;
            }
            
            if (mediaRequest.type === 'image') {
                if (enviarResposta) await enviarResposta('🎨 Gerando imagem com IA...', messageKey);
                const result = await generateImage(mediaRequest.prompt);
                
                if (result.success) {
                    await currentSock.sendMessage(clientId, {
                        image: { url: result.imageUrl },
                        caption: `🖼️ *Imagem gerada!*\n\n📝 Prompt: ${mediaRequest.prompt}`
                    });
                } else if (enviarResposta) {
                    await enviarResposta(`❌ ${result.error}`, messageKey);
                }
                return;
            }
            
            if (mediaRequest.type === 'sticker_text') {
                if (enviarResposta) await enviarResposta('📝 Gerando figurinha animada...', messageKey);
                const result = await generateAttpSticker(mediaRequest.text);
                
                if (result.success) {
                    await currentSock.sendMessage(clientId, {
                        sticker: result.stickerBuffer
                    });
                } else if (enviarResposta) {
                    await enviarResposta(`❌ ${result.error}`, messageKey);
                }
                return;
            }
            
        } catch (error) {
            console.error('[OWNER AI] ❌ Erro ao processar mídia:', error.message);
            if (enviarResposta) {
                await enviarResposta('❌ Ocorreu um erro ao processar sua solicitação.', messageKey);
            }
            return;
        }
    }
    
    // ✅ PRIORIDADE 2: VERIFICA INTENÇÃO DE DESBLOQUEAR
    if (detectAIIntent(msgLower)) {
        console.log(`[OWNER AI] 🔓 Usuário quer reativar IA: ${clientId}`);
        unblockUser(clientId);
        const msg = `🤖 *IA Reativada!*\n\nEstou de volta para ajudar! Como posso ser útil? 😊`;
        if (enviarResposta) await enviarResposta(msg, messageKey);
        return;
    }
    
    // ✅ VERIFICA SE ESTÁ BLOQUEADO
    if (isUserBlocked(clientId)) {
        console.log(`[OWNER AI] 🚫 Usuário bloqueado - ignorando mensagem de ${clientId}`);
        return;
    }
    
    if (isGroup) {
        const respondGroups = await shouldRespondToGroups();
        if (!respondGroups) {
            console.log(`[OWNER AI] 👥 Grupos desabilitados - ignorando`);
            return;
        }
        if (!isMentioned) {
            console.log(`[OWNER AI] 👥 Não foi mencionado no grupo - ignorando`);
            return;
        }
        console.log(`[OWNER AI] 👥 Bot mencionado no grupo - processando`);
    }
    
    const paused = await isBotPaused();
    if (paused) {
        console.log(`[OWNER AI] ⏸️ Bot pausado - não respondendo a ${clientId}`);
        return;
    }
    
    const resetou = resetIgnoreIfKeyword(message, clientId);
    
    if (!resetou && detectRepetition(message, clientId)) {
        if (repetitionControl[clientId].count === REPETITION_THRESHOLD) {
            const msg = `*Ops!* Percebi que você está repetindo a mesma mensagem.\n\nVou encerrar nossa conversa por aqui. Se precisar falar comigo novamente, basta enviar:\n\n_"falar com a assistente"_\n\nAté breve! 👋`;
            if (enviarResposta) await enviarResposta(msg, messageKey);
            return;
        }
        console.log(`[OWNER AI] 🔇 Ignorando mensagem repetida de ${clientId}`);
        return;
    }
    
    if (resetou) {
        if (messageQueue[clientId]) messageQueue[clientId] = [];
        if (responseTimers[clientId]) {
            clearTimeout(responseTimers[clientId]);
            delete responseTimers[clientId];
        }
        if (typingIntervals[clientId]) {
            clearInterval(typingIntervals[clientId]);
            delete typingIntervals[clientId];
        }
    }
    
    if (isHumanModeActive(clientId)) {
        if (detectAIIntent(msgLower)) {
            deactivateHumanMode(clientId);
            unblockUser(clientId);
            const msg = `*Estou ouvindo novamente.*\n\nComo posso ajudar você? 😊`;
            if (enviarResposta) await enviarResposta(msg, messageKey);
            return;
        }
        
        if (detectHumanIntent(msgLower)) {
            updateHumanModeTimestamp(clientId);
            const msg = `⏳ *Ander ainda está analisando*\n\nEle responderá em breve. Obrigado pela paciência! 🙏`;
            if (enviarResposta) await enviarResposta(msg, messageKey);
            return;
        }
        
        console.log(`[OWNER AI] 🔇 Modo humano ativo - IA silenciada para ${clientId}`);
        return;
    }
    
    if (!messageQueue[clientId]) {
        messageQueue[clientId] = [];
    }
    
    messageQueue[clientId].push({
        text: message,
        key: messageKey
    });
    
    console.log(`[OWNER AI DEBOUNCE] 📥 Mensagem adicionada à fila (${clientId}): "${message}"`);
    
    if (responseTimers[clientId]) {
        clearTimeout(responseTimers[clientId]);
        console.log(`[OWNER AI DEBOUNCE] ⏸️ Timer cancelado - resetando para 10s`);
    }
    
    if (typingIntervals[clientId]) {
        clearInterval(typingIntervals[clientId]);
        delete typingIntervals[clientId];
    }
    
    if (enviarDigitando) {
        await enviarDigitando();
        console.log(`[OWNER AI DEBOUNCE] ⌨️ Status "digitando..." enviado`);
    }
    
    typingIntervals[clientId] = setInterval(async () => {
        if (enviarDigitando) {
            await enviarDigitando();
            console.log(`[OWNER AI DEBOUNCE] ⌨️ Status "digitando..." reenviado`);
        }
    }, TYPING_INTERVAL);
    
    responseTimers[clientId] = setTimeout(async () => {
        console.log(`[OWNER AI DEBOUNCE] ⏰ Timer finalizado - processando mensagens`);
        
        if (typingIntervals[clientId]) {
            clearInterval(typingIntervals[clientId]);
            delete typingIntervals[clientId];
        }
        
        const mensagensAgrupadas = [...messageQueue[clientId]];
        messageQueue[clientId] = [];
        
        console.log(`[OWNER AI DEBOUNCE] 📨 Processando ${mensagensAgrupadas.length} mensagem(ns)`);
        
        const ultimaMensagemKey = mensagensAgrupadas[mensagensAgrupadas.length - 1].key;
        const mensagemCompleta = mensagensAgrupadas.map(m => m.text).join(' ');
        
        // ✅ NÃO PASSA SOCKET AQUI
        const resposta = await processClientMessage(mensagemCompleta, clientId, null);
        
        if (resposta && enviarResposta) {
            console.log(`[OWNER AI DEBOUNCE] ✅ Resposta gerada: "${resposta.substring(0, 100)}..."`);
            
            // ✅ PRIMEIRO: ENVIA A RESPOSTA COM RETRY (5 tentativas)
            const enviado = await enviarComRetry(async () => {
                await enviarResposta(resposta, ultimaMensagemKey);
            }, 5);
            
            if (enviado) {
                console.log(`[OWNER AI DEBOUNCE] 📤 Resposta enviada com sucesso!`);
            } else {
                console.error(`[OWNER AI DEBOUNCE] ❌ Falha ao enviar resposta após todas as tentativas`);
            }
            
            // ✅ DEPOIS: TENTA PARAR O DIGITANDO (se falhar, não importa)
            try {
                const currentSock = getSock();
                if (currentSock) {
                    const remoteJid = isGroup ? clientId : `${clientId}@s.whatsapp.net`;
                    await currentSock.sendPresenceUpdate('available', remoteJid);
                    console.log('[OWNER AI DEBOUNCE] ⌨️ Status "digitando..." parado');
                }
            } catch (presenceError) {
                console.log('[OWNER AI DEBOUNCE] ⚠️ Erro ao parar digitando (ignorado):', presenceError.message);
            }
        } else {
            console.log(`[OWNER AI DEBOUNCE] 🔇 Sem resposta para enviar`);
        }
        
        delete responseTimers[clientId];
        
    }, DEBOUNCE_TIME);
    
    console.log(`[OWNER AI DEBOUNCE] ⏳ Timer iniciado - aguardando ${DEBOUNCE_TIME/1000}s`);
}

async function processClientMessage(message, phoneNumber, ownerSock) {
    const clientId = phoneNumber || 'unknown';
    const msgLower = message.toLowerCase().trim();
    
    await updateLastActivity();
    
    if (detectRejectIntent(msgLower)) {
        blockUser(clientId);
        return `*Entendido!*\n\nVou parar de responder agora. Caso mude de ideia e queira falar comigo novamente, basta enviar:\n\n_"falar com assistente"_\n\nAté logo! 👋`;
    }
    
    if (detectHumanIntent(msgLower)) {
        activateHumanMode(clientId);
        blockUser(clientId);
        
        try {
            // ✅ PEGA SOCKET ATUAL
            const OwnerBot = require('./OwnerBot');
            const currentSock = OwnerBot.getSocket();
            const ownerPhone = process.env.OWNER_PHONE || '';
            
            if (currentSock && ownerPhone) {
                await currentSock.sendMessage(ownerPhone, {
                    text: `🔔 *NOVO ATENDIMENTO SOLICITADO*\n\n📱 Cliente: ${clientId}\n💬 Mensagem: "${message}"\n\n⚠️ Cliente aguardando resposta humana.`
                });
            }
        } catch (e) {
            console.error('[OWNER AI] Erro ao notificar owner:', e.message);
        }
        
        return `✅ *Transferido para Ander*\n\nSua conversa foi encaminhada para o Ander. Ele responderá em breve! ⏳\n\n_Enquanto isso, aguarde..._`;
    }
    
    if (!conversationStates[clientId]) {
        conversationStates[clientId] = {
            historico: [],
            primeiraInteracao: true,
            nomeCliente: null,
            jaCumprimentou: false,
            conversouAntes: false
        };
        saveStates();
    }
    
    const estado = conversationStates[clientId];
    
    if (estado.primeiraInteracao) {
        estado.primeiraInteracao = false;
        
        try {
            const cliente = await prisma.user.findFirst({
                where: { phone: { contains: phoneNumber } },
                select: { name: true }
            });
            
            if (cliente && cliente.name) {
                estado.nomeCliente = cliente.name.split(' ')[0];
                saveStates();
            }
        } catch (error) {
            console.error('[OWNER AI] Erro ao buscar cliente:', error.message);
        }
    }
    
    return await conversarComGPT5Mini(message, estado.historico, clientId, estado.nomeCliente, estado.jaCumprimentou);
}

async function conversarComGPT5Mini(mensagem, historico, clientId, nomeCliente, jaCumprimentou) {
    try {
        if (!SPIDER_API_TOKEN) {
            console.error('[OWNER AI] ❌ SPIDER_API_TOKEN não configurado');
            return 'Desculpe, estou com problemas técnicos. Tente novamente! 🔧';
        }
        
        const hour = new Date().getHours();
        const greeting = hour >= 6 && hour < 12 ? 'Bom dia' : 
                         hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
        
        let contexto = '';
        if (historico.length > 0) {
            const ultimas = historico.slice(-3);
            let contextoTemp = '';
            
            for (const h of ultimas) {
                const label = h.role === 'user' ? 'Cliente' : 'Você';
                const content = h.content.length > 50 ? h.content.substring(0, 50) + '...' : h.content;
                const linha = `${label}: ${content}\n`;
                
                if ((contextoTemp + linha).length > 300) break;
                contextoTemp += linha;
            }
            
            contexto = contextoTemp;
        }
        
        const promptSistema = `Você é AlphaBot, criado pelo Ander.

IMPORTANTE: Quando o usuário pedir PLAYLISTS ou LISTAS de músicas, responda com uma lista numerada de músicas! 

EXEMPLO:
Cliente: "Faz uma playlist da Lady Gaga"
Você: "🎵 *Playlist da Lady Gaga*

1. Bad Romance
2. Poker Face
3. Born This Way
4. Shallow
5. Just Dance
6. Telephone
7. Paparazzi
8. Alejandro
9. The Edge of Glory
10. Rain On Me

Para baixar, use: *baixar música [nome]*"

FUNÇÕES DISPONÍVEIS:
- Baixar música: "baixar música [nome]"
- Gerar imagem: "gerar imagem [descrição]"
- Criar figurinha: "criar figurinha [com imagem]"
- Baixar vídeo YouTube: "baixar vídeo [nome]"
- Baixar Instagram: "baixar reels [link]"
- Baixar TikTok: "baixar tiktok [link]"
- Horóscopo: "horóscopo [signo]"

PRODUTOS DO ANDER:
1. AlphaBot: Bot IA para WhatsApp
2. Markaí: App de agendamentos (markaiapp.com.br)
3. FaleZap: Central de mensagens (em desenvolvimento)
4. Portfólio: anderhonorato.github.io/meu-portfolio

PERSONALIDADE E INSTRUÇÕES:
- Carismático, direto e útil
- Use 2-3 emojis (relacionado ao tema)
- Respostas: 80-500 caracteres
- Complete frases sempre
- Formate em *negrito* e _itálico_ quando necessário
- Formate o texto com paragrafos quando necessário


${!jaCumprimentou ? `PRIMEIRA MENSAGEM: Use "${greeting}" e se apresente brevemente` : `Responda diretamente ao pedido`}
${nomeCliente ? `Cliente: ${nomeCliente}` : ''}
${contexto ? `\nÚLTIMAS:\n${contexto}` : ''}

REGRAS:
- Preço? "Fale com Ander: (77)99951-2937"
- Seja objetivo e útil
- Formatação: *negrito* _itálico_`;

        const prompt = `${promptSistema}\n\nCliente: ${mensagem}\nVocê:`;
        const promptFinal = prompt.length > 2000 ? prompt.substring(0, 2000) : prompt;
        
        console.log('[OWNER AI] 📤 Enviando para GPT-5 Mini...');
        console.log('[OWNER AI] 📏 Tamanho do prompt:', promptFinal.length, 'caracteres');
        
        const response = await axios.post(
            `${SPIDER_API_BASE_URL}/gpt-5-mini?api_key=${SPIDER_API_TOKEN}`,
            { text: promptFinal },
            { 
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000 
            }
        );
        
        let resposta = response.data?.response?.trim() || 'Desculpe, não entendi.';
        
        if (!jaCumprimentou && conversationStates[clientId]) {
            conversationStates[clientId].jaCumprimentou = true;
            saveStates();
        }
        
        resposta = resposta.replace(/\*\*/g, '*');
        
        if (resposta.length > 1000) {
            let corte = resposta.lastIndexOf('.', 1000);
            if (corte === -1) corte = resposta.lastIndexOf('!', 1000);
            if (corte === -1) corte = resposta.lastIndexOf('?', 1000);
            
            if (corte > 500) {
                resposta = resposta.substring(0, corte + 1);
            } else {
                resposta = resposta.substring(0, 997) + '...';
            }
        }
        
        if (resposta.length < 1000) {
            const ultimoChar = resposta.slice(-1);
            const pontuacaoValida = ['.', '!', '?', '😊', '😄', '👋', '🙏', '✨', '💡'];
            
            if (!pontuacaoValida.includes(ultimoChar)) {
                let ultimaPontuacao = -1;
                for (let i = resposta.length - 1; i >= 0; i--) {
                    if (['.', '!', '?'].includes(resposta[i])) {
                        ultimaPontuacao = i;
                        break;
                    }
                }
                
                if (ultimaPontuacao > 100) {
                    resposta = resposta.substring(0, ultimaPontuacao + 1);
                }
            }
        }
        
        historico.push({ role: 'user', content: mensagem });
        historico.push({ role: 'assistant', content: resposta });
        
        if (historico.length > 10) {
            historico.splice(0, historico.length - 10);
        }
        
        saveStates();
        
        console.log('[OWNER AI] ✅ Resposta gerada:', resposta.substring(0, 100) + '...');
        console.log('[OWNER AI] 📏 Tamanho:', resposta.length, 'caracteres');
        return resposta;
        
    } catch (error) {
        console.error('[OWNER AI] ❌ Erro GPT-5 Mini:', error.message);
        
        if (error.response?.status === 500) {
            console.error('[OWNER AI] ⚠️ Erro 500 - Prompt muito grande ou API instável');
        }
        
        return 'Desculpe, tive um problema técnico. Posso transferir para o Ander? 🔧';
    }
}

function getSystemStats() {
    const totalConversations = Object.keys(conversationStates).length;
    const activeHumanMode = Object.keys(humanModeActive).length;
    const totalBlocked = Object.keys(blockedUsers).length;
    
    return {
        totalConversations,
        activeHumanMode,
        totalBlocked,
        conversationStates: Object.keys(conversationStates),
        humanModeClients: Object.keys(humanModeActive),
        blockedClients: Object.keys(blockedUsers)
    };
}

module.exports = {
    processClientMessage,
    processOwnerMessage,
    processarMensagemComDebounce,
    isHumanModeActive,
    deactivateHumanMode,
    getSystemStats,
    loadSavedStates,
    saveStates
};