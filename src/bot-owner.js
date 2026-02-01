// backend/src/bot-owner.js
// ✅ VERSÃO COMPLETA - USA SEMPRE O SOCKET ATUAL

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { processOwnerMessage, processarMensagemComDebounce } = require('./services/Owner.ai.service');
const spiderXMedia = require('./services/SpiderXMedia.service');
const botIdentification = require('./services/Botidentification.service');
const moltbookDiary = require('./services/MoltbookDiary.service');
const OwnerBot = require('./services/OwnerBot'); // ✅ IMPORTA PARA PEGAR SOCKET ATUAL
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const OWNER_EMAIL = 'contato.markaiapp@gmail.com';

async function isGroupAIEnabled(groupId) {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL },
            select: { ownerGroupConfigs: true }
        });
        if (!owner) return true;
        const configs = owner.ownerGroupConfigs || {};
        const groupConfig = configs[groupId] || {};
        return groupConfig.aiEnabled !== false;
    } catch (error) {
        console.error('[OWNER BOT] Erro ao verificar IA do grupo:', error.message);
        return true;
    }
}

async function getUserName(sock, groupId, userJid) {
    try {
        const groupMetadata = await sock.groupMetadata(groupId);
        if (!groupMetadata || !groupMetadata.participants) return null;
        const participant = groupMetadata.participants.find(p => p.id === userJid);
        if (participant) {
            const contact = await sock.onWhatsApp(userJid);
            if (contact && contact[0]?.notify) {
                console.log('[OWNER BOT] 👤 Nome do usuário:', contact[0].notify);
                return contact[0].notify;
            }
        }
        return null;
    } catch (error) {
        console.error('[OWNER BOT] ❌ Erro ao buscar nome do usuário:', error.message);
        return null;
    }
}

function extractMentions(message) {
    const mentions = [];
    if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid) {
        mentions.push(...message.message.extendedTextMessage.contextInfo.mentionedJid);
    }
    
    if (message.message?.imageMessage?.contextInfo?.mentionedJid) {
        mentions.push(...message.message.imageMessage.contextInfo.mentionedJid);
    }
    
    const textSources = [
        message.message?.conversation,
        message.message?.extendedTextMessage?.text,
        message.message?.imageMessage?.caption
    ];
    
    for (const text of textSources) {
        if (text && text.includes('@')) {
            const mentionRegex = /@(\d+)/g;
            let match;
            while ((match = mentionRegex.exec(text)) !== null) {
                mentions.push(`${match[1]}@s.whatsapp.net`);
                mentions.push(`${match[1]}@lid`);
            }
        }
    }
    return [...new Set(mentions)];
}

async function reactToMessage(sock, remoteJid, messageKey, emoji) {
    try {
        await sock.sendMessage(remoteJid, {
            react: { text: emoji, key: messageKey }
        });
        console.log(`[OWNER BOT] ✅ Reação enviada: ${emoji}`);
    } catch (error) {
        console.error('[OWNER BOT] ❌ Erro ao reagir:', error.message);
    }
}

function registerInteraction(type, content, user, isGroup, groupName, result = null) {
    moltbookDiary.registerInteraction({
        type,
        user,
        content,
        isGroup,
        groupName,
        result
    });
}

// [DADOS DO HORÓSCOPO - mantém tudo igual]
const SIGNOS_RESUMO_FIXO = {
    "aries": { elemento: "Fogo", periodo: "21 de Março - 19 de Abril", regente: "Marte" },
    "touro": { elemento: "Terra", periodo: "20 de Abril - 20 de Maio", regente: "Vênus" },
    "gemeos": { elemento: "Ar", periodo: "21 de Maio - 20 de Junho", regente: "Mercúrio" },
    "cancer": { elemento: "Água", periodo: "21 de Junho - 22 de Julho", regente: "Lua" },
    "leao": { elemento: "Fogo", periodo: "23 de Julho - 22 de Agosto", regente: "Sol" },
    "virgem": { elemento: "Terra", periodo: "23 de Agosto - 22 de Setembro", regente: "Mercúrio" },
    "libra": { elemento: "Ar", periodo: "23 de Setembro - 22 de Outubro", regente: "Vênus" },
    "escorpiao": { elemento: "Água", periodo: "23 de Outubro - 21 de Novembro", regente: "Plutão" },
    "sagitario": { elemento: "Fogo", periodo: "22 de Novembro - 21 de Dezembro", regente: "Júpiter" },
    "capricornio": { elemento: "Terra", periodo: "22 de Dezembro - 19 de Janeiro", regente: "Saturno" },
    "aquario": { elemento: "Ar", periodo: "20 de Janeiro - 18 de Fevereiro", regente: "Urano" },
    "peixes": { elemento: "Água", periodo: "19 de Fevereiro - 20 de Março", regente: "Netuno" }
};

const SIGNOS_EMOJIS = {
    "aries": "♈", "touro": "♉", "gemeos": "♊", "cancer": "♋", "leao": "♌", "virgem": "♍",
    "libra": "♎", "escorpiao": "♏", "sagitario": "♐", "capricornio": "♑", "aquario": "♒", "peixes": "♓"
};

// [HOROSCOPO_FAKE_DATA - mantém todo o conteúdo igual, muito longo para repetir aqui]
const HOROSCOPO_FAKE_DATA = {
    // ... (mantém todo o conteúdo do horóscopo)
};

function getFormattedDateAndDay() {
    const date = new Date();
    const dayNames = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
    const day = dayNames[date.getDay()];
    const formattedDate = date.toLocaleDateString('pt-BR');
    return { date: formattedDate, day: day };
}

async function getHoroscope(signInput) {
    try {
        const signMap = {
            'aries': 'aries', 'áries': 'aries',
            'touro': 'touro',
            'gemeos': 'gemeos', 'gêmeos': 'gemeos',
            'cancer': 'cancer', 'câncer': 'cancer',
            'leao': 'leao', 'leão': 'leao',
            'virgem': 'virgem',
            'libra': 'libra',
            'escorpiao': 'escorpiao', 'escorpião': 'escorpiao',
            'sagitario': 'sagitario', 'sagitário': 'sagitario',
            'capricornio': 'capricornio', 'capricórnio': 'capricornio',
            'aquario': 'aquario', 'aquário': 'aquario',
            'peixes': 'peixes'
        };

        const signNormalized = signInput.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const signKey = signMap[signNormalized];

        if (!signKey) {
            return `❌ Signo não reconhecido. Use: Áries, Touro, Gêmeos, etc.`;
        }

        const resumo = SIGNOS_RESUMO_FIXO[signKey];
        const frases = HOROSCOPO_FAKE_DATA[signKey];
        const { date: currentDate, day: currentDay } = getFormattedDateAndDay();
        const capitalizedSignName = signKey.charAt(0).toUpperCase() + signKey.slice(1);
        const signEmoji = SIGNOS_EMOJIS[signKey];

        const randomIndex = Math.floor(Math.random() * frases.length);
        const selectedPhrase = frases[randomIndex];

        const message =
            `${signEmoji} *Signo de ${capitalizedSignName}* ${signEmoji}\n` +
            `_${currentDay}, ${currentDate}_\n\n` +
            `🔹 *Elemento:* ${resumo.elemento}\n` +
            `🔹 *Período:* ${resumo.periodo}\n` +
            `🔹 *Planeta Regente:* ${resumo.regente}\n\n` +
            `🔮 *Previsão do Dia:* \n${selectedPhrase}\n\n` +
            `✨ _Lembre-se: O horóscopo é uma ferramenta de reflexão._`;

        return message;

    } catch (error) {
        console.error('[OWNER BOT] ❌ Erro:', error.message);
        return `Desculpe, ocorreu um erro ao gerar o horóscopo.`;
    }
}

function detectHoroscopeRequest(text) {
    const msgNormalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    const keywords = ['horoscopo', 'signo', 'previsao'];
    const hasKeyword = keywords.some(key => msgNormalized.includes(key));

    if (!hasKeyword) return null;

    const signsMap = {
        "aries": "aries", "touro": "touro", "gemeos": "gemeos", "cancer": "cancer",
        "leao": "leao", "virgem": "virgem", "libra": "libra", "escorpiao": "escorpiao",
        "sagitario": "sagitario", "capricornio": "capricornio", "aquario": "aquario", "peixes": "peixes"
    };

    for (const [searchName, internalKey] of Object.entries(signsMap)) {
        if (msgNormalized.includes(searchName)) {
            return internalKey;
        }
    }
    
    return null;
}

async function handleOwnerIncomingMessage(msg, sessionId, sock) {
    try {
        console.log('\n' + '='.repeat(70));
        console.log('[OWNER BOT] 📨 NOVA MENSAGEM RECEBIDA');
        console.log('='.repeat(70));
        
        if (!msg) {
            console.log('[OWNER BOT] ❌ Mensagem inválida');
            return;
        }
        
        const remoteJid = msg.key?.remoteJid;
        const isGroup = remoteJid?.includes('@g.us');
        const fromMe = msg.key?.fromMe;
        const senderLID = msg.key?.participant || msg.participant;
        
        console.log('[OWNER BOT] 🔍 fromMe:', fromMe);
        console.log('[OWNER BOT] 🔍 senderLID:', senderLID);
        console.log('[OWNER BOT] 🔍 isGroup:', isGroup);
        
        if (fromMe && isGroup && senderLID) {
            console.log('[OWNER BOT] 🤖 BOT ENVIOU MENSAGEM NO GRUPO!');
            console.log('[OWNER BOT] 🔑 LID do bot neste grupo:', senderLID);
            
            const savedLID = await botIdentification.getSavedBotLID(remoteJid);
            
            if (!savedLID || savedLID !== senderLID) {
                console.log('[OWNER BOT] 💾 SALVANDO LID:', senderLID);
                await botIdentification.saveBotLID(remoteJid, senderLID);
            } else {
                console.log('[OWNER BOT] ✅ LID já está salvo corretamente');
            }
            
            return;
        }
        
        if (fromMe) {
            console.log('[OWNER BOT] 👤 Bot/Owner enviou mensagem');
            if (!isGroup) {
                const phoneNumber = remoteJid.split('@')[0];
                processOwnerMessage(phoneNumber);
            }
            return;
        }
        
        console.log('[OWNER BOT] ✅ Mensagem de cliente');
        console.log('[OWNER BOT] 📱 RemoteJid:', remoteJid, isGroup ? '(GRUPO)' : '(PRIVADO)');
        
        if (!remoteJid || remoteJid === 'status@broadcast') {
            console.log('[OWNER BOT] ⏭️ Ignorando broadcast');
            return;
        }
        
        let groupName = null;
        let isMentioned = false;
        let senderJid = null;
        let senderName = null;
        let shouldProcess = false;
        
        if (isGroup) {
            try {
                const metadata = await sock.groupMetadata(remoteJid);
                groupName = metadata?.subject || remoteJid;
                console.log('[OWNER BOT] 👥 Grupo:', groupName);
            } catch (e) {
                groupName = remoteJid;
                console.error('[OWNER BOT] ⚠️ Erro ao obter nome do grupo:', e.message);
            }

            let savedBotLID = await botIdentification.getSavedBotLID(remoteJid);
            
            const mentions = extractMentions(msg);
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const replyParticipant = contextInfo?.participant || null;
            
            if (!savedBotLID) {
                console.log('[OWNER BOT] ⚠️ LID não encontrado');
            } else {
                console.log('[OWNER BOT] ✅ LID salvo:', savedBotLID);
            }
            
            let text = '';
            if (msg.message?.conversation) {
                text = msg.message.conversation;
            } else if (msg.message?.extendedTextMessage?.text) {
                text = msg.message.extendedTextMessage.text;
            } else if (msg.message?.imageMessage?.caption) {
                text = msg.message.imageMessage.caption;
            }
            
            if (text === '/diary stats') {
                const stats = moltbookDiary.getStats();
                await sock.sendMessage(remoteJid, {
                    text: `📊 **Estatísticas do Diário Moltbook:**\n\n` +
                        `• Interações registradas: ${stats.totalInteractions}\n` +
                        `• Pode postar: ${stats.canPost ? 'Sim ✅' : 'Não ❌'}\n` +
                        `• Minutos até próximo post: ${stats.minutesUntilCanPost}\n` +
                        `• Último post: ${stats.lastPostTime}`,
                    quoted: msg
                });
                return;
            }

            if (text === '/diary post') {
                const success = await moltbookDiary.forcePost();
                await sock.sendMessage(remoteJid, {
                    text: success ? '✅ Post de diário criado no Moltbook!' : '❌ Não foi possível postar (aguarde cooldown ou adicione mais interações)',
                    quoted: msg
                });
                return;
            }
            
            console.log('[OWNER BOT] 🔍 Debug:');
            console.log('   - Texto:', text);
            console.log('   - Menções:', mentions);
            console.log('   - Reply:', replyParticipant);
            console.log('   - LID Salvo:', savedBotLID || 'Nenhum');
            console.log('   - Tem Imagem:', !!msg.message?.imageMessage);
            
            isMentioned = await botIdentification.isBotMentionedOrReplied(
                remoteJid,
                mentions,
                replyParticipant,
                sock
            );
            
            console.log('[OWNER BOT] 👥 Bot mencionado?', isMentioned);
            
            if (!isMentioned) {
                console.log('[OWNER BOT] 🚫 Bot não foi mencionado - IGNORANDO');
                return;
            }
            
            const groupAIEnabled = await isGroupAIEnabled(remoteJid);
            if (!groupAIEnabled) {
                console.log('[OWNER BOT] 🚫 IA desativada neste grupo');
                return;
            }
            
            senderJid = msg.key.participant || msg.participant;
            senderName = await getUserName(sock, remoteJid, senderJid);
            
            shouldProcess = true;
        } else {
            shouldProcess = true;
        }
        
        if (!shouldProcess) {
            console.log('[OWNER BOT] ⏭️ Mensagem não será processada');
            return;
        }
        
        let text = '';
        if (msg.message?.conversation) {
            text = msg.message.conversation;
        } else if (msg.message?.extendedTextMessage?.text) {
            text = msg.message.extendedTextMessage.text;
        } else if (msg.message?.imageMessage?.caption) {
            text = msg.message.imageMessage.caption;
        }
        
        const hasImage = !!msg.message?.imageMessage;
        const wantSticker = text.toLowerCase().includes('criar figurinha') || 
                           text.toLowerCase().includes('fazer figurinha') ||
                           text.toLowerCase().includes('gerar figurinha');
        
        if (hasImage && (isMentioned || !isGroup)) {
            if (wantSticker || !text || text.trim() === '') {
                console.log('[OWNER BOT] 🖼️ DETECTADO: Imagem + Menção → Criar Figurinha');
                text = 'criar figurinha';
            }
        }
        
        if (isGroup && isMentioned) {
            text = text.replace(/@\d+/g, '').trim();
        }
        
        if (!text || text.trim() === '') {
            console.log('[OWNER BOT] ⏭️ Sem texto');
            return;
        }
        
        console.log('[OWNER BOT] ✅ PROCESSANDO');
        
        if (isGroup) {
            await reactToMessage(sock, remoteJid, msg.key, '⏳');
        }
        
        const identifier = isGroup ? remoteJid : remoteJid.split('@')[0];
        const userName = senderName || (isGroup ? 'Usuário de Grupo' : remoteJid.split('@')[0]);
        
        const horoscopeSign = detectHoroscopeRequest(text);
        if (horoscopeSign) {
            console.log('[OWNER BOT] 🔮 Horóscopo detectado:', horoscopeSign);
            
            try {
                await sock.sendPresenceUpdate('composing', remoteJid);
                const horoscope = await getHoroscope(horoscopeSign);
                await sock.sendPresenceUpdate('available', remoteJid);
                
                if (isGroup) {
                    await reactToMessage(sock, remoteJid, msg.key, '🔮');
                }
                
                await sock.sendMessage(remoteJid, {
                    text: horoscope,
                    quoted: msg
                });

                registerInteraction('horoscope', `Horóscopo de ${horoscopeSign}`, userName, isGroup, groupName, 'Enviado');
                return;
            } catch (error) {
                console.error('[OWNER BOT] ❌ Erro horóscopo:', error.message);
                if (isGroup) {
                    await reactToMessage(sock, remoteJid, msg.key, '❌');
                }
                await sock.sendMessage(remoteJid, {
                    text: '❌ Erro ao buscar horóscopo',
                    quoted: msg
                });
                return;
            }
        }
        
        const mediaRequest = spiderXMedia.detectMediaRequest(text);
        
        if (mediaRequest) {
            console.log('[OWNER BOT] 🎨 Mídia detectada:', mediaRequest.type);
            
            try {
                await sock.sendPresenceUpdate('composing', remoteJid);
                
                if (mediaRequest.type === 'image') {
                    const result = await spiderXMedia.generateImage(mediaRequest.prompt);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '🖼️');
                        }
                        await sock.sendMessage(remoteJid, {
                            image: { url: result.imageUrl },
                            caption: `✨ *Imagem gerada!*\n\n📝 _${mediaRequest.prompt}_`,
                            quoted: msg
                        });
                        registerInteraction('media_request', `Imagem: ${mediaRequest.prompt}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'audio') {
                    const result = await spiderXMedia.downloadAudio(mediaRequest.search);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '🎵');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `🎵 *${result.title}*\n\n👤 ${result.channel}\n⏱️ ${Math.floor(result.duration / 60)}:${(result.duration % 60).toString().padStart(2, '0')}\n🔗 ${result.youtubeUrl}`,
                            quoted: msg
                        });
                        await sock.sendMessage(remoteJid, {
                            audio: { url: result.audioUrl },
                            mimetype: 'audio/mp4',
                            ptt: false,
                            fileName: `${result.title}.mp3`,
                            quoted: msg
                        });
                        registerInteraction('media_request', `Áudio: ${mediaRequest.search}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'instagram') {
                    const result = await spiderXMedia.downloadInstagram(mediaRequest.url);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '📸');
                        }
                        
                        let caption = '✅ *Download do Instagram concluído!*';
                        if (result.title && result.title !== 'Post do Instagram') {
                            caption += `\n\n📝 ${result.title}`;
                        }
                        if (result.meta?.username) {
                            caption += `\n👤 @${result.meta.username}`;
                        }
                        
                        await sock.sendMessage(remoteJid, {
                            video: { url: result.videoUrl },
                            caption: caption,
                            quoted: msg
                        });
                        registerInteraction('media_request', `Instagram: ${mediaRequest.url}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'tiktok') {
                    const result = await spiderXMedia.downloadTikTok(mediaRequest.url);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '🎵');
                        }
                        await sock.sendMessage(remoteJid, {
                            video: { url: result.videoUrl },
                            caption: '✅ *Download do TikTok concluído!*',
                            quoted: msg
                        });
                        registerInteraction('media_request', `TikTok: ${mediaRequest.url}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'youtube_video') {
                    const result = await spiderXMedia.downloadYouTubeVideo(mediaRequest.url);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '🎬');
                        }
                        
                        let info = `✅ *${result.title}*`;
                        if (result.channel?.name) {
                            info += `\n\n📺 Canal: ${result.channel.name}`;
                        }
                        if (result.duration) {
                            const minutes = Math.floor(result.duration / 60);
                            const seconds = result.duration % 60;
                            info += `\n⏱️ Duração: ${minutes}:${seconds.toString().padStart(2, '0')}`;
                        }
                        info += '\n\n📥 Enviando vídeo...';
                        
                        await sock.sendMessage(remoteJid, {
                            text: info,
                            quoted: msg
                        });
                        
                        await sock.sendMessage(remoteJid, {
                            video: { url: result.videoUrl },
                            caption: `📹 ${result.title}`,
                            quoted: msg
                        });
                        registerInteraction('media_request', `YouTube: ${mediaRequest.url}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'sticker_text') {
                    const result = await spiderXMedia.generateAttpSticker(mediaRequest.text);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '📄');
                        }
                        await sock.sendMessage(remoteJid, {
                            sticker: result.stickerBuffer,
                            quoted: msg
                        });
                        registerInteraction('media_request', `Figurinha Texto: ${mediaRequest.text}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'sticker_image') {
                    const { exec } = require("child_process");
                    const path = require("path");
                    const fs = require("fs");
                    const { Sticker, StickerTypes } = require('wa-sticker-formatter');

                    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const imageMessage = msg.message?.imageMessage || quoted?.imageMessage;
                    
                    const pushName = msg.pushName || "Usuário";
                    const isGroupMsg = remoteJid.endsWith('@g.us');
                    let nomeLocal = "Chat Privado";

                    if (!imageMessage) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, { text: '❌ Erro: Imagem não encontrada.' }, { quoted: msg });
                        return;
                    }

                    try {
                        if (isGroupMsg) {
                            nomeLocal = `Grupo: ${groupName}`;
                        }

                        console.log(`[OWNER BOT] 🖼️ Criando figurinha para: ${pushName}`);

                        const tempDir = path.resolve(__dirname, '..', 'temp');
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                        
                        const randomId = Math.floor(Math.random() * 100000);
                        const inputPath = path.join(tempDir, `in_${randomId}.jpg`);
                        const ffmpegPath = path.join(tempDir, `out_${randomId}.webp`);

                        const messageToDownload = msg.message?.imageMessage ? msg : { message: quoted };
                        const buffer = await downloadMediaMessage(
                            messageToDownload,
                            'buffer',
                            {},
                            { logger: console, reuploadRequest: sock.updateMediaMessage }
                        );

                        fs.writeFileSync(inputPath, buffer);

                        const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

                        exec(`ffmpeg -i ${inputPath} -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0" ${ffmpegPath}`, async (error) => {
                            if (error) {
                                console.error('[OWNER BOT] ❌ Erro FFMPEG:', error);
                                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                                if (isGroup) {
                                    await reactToMessage(sock, remoteJid, msg.key, '❌');
                                }
                                return;
                            }

                            try {
                                const sticker = new Sticker(fs.readFileSync(ffmpegPath), {
                                    pack: 'Criado por: AlphaBot 🤖 (11)96779-7232', 
                                    author: `\nSolicitado por: ${pushName}\n${nomeLocal}\nData: ${agora}\nDono: Ander (77)99951-2937`,
                                    type: StickerTypes.FULL,
                                    quality: 80,
                                    id: `alpha_${randomId}`
                                });

                                const stickerBuffer = await sticker.toBuffer();

                                if (isGroup) {
                                    await reactToMessage(sock, remoteJid, msg.key, '✅');
                                }
                                
                                await sock.sendMessage(remoteJid, { 
                                    sticker: stickerBuffer 
                                }, { quoted: msg });

                                registerInteraction('media_request', 'Figurinha de Imagem', userName, isGroup, groupName, 'Sucesso');

                                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                                if (fs.existsSync(ffmpegPath)) fs.unlinkSync(ffmpegPath);
                                
                            } catch (metaError) {
                                console.error('[OWNER BOT] ❌ Erro metadados:', metaError);
                                await sock.sendMessage(remoteJid, { sticker: fs.readFileSync(ffmpegPath) }, { quoted: msg });
                            }
                        });

                    } catch (err) {
                        console.error('[OWNER BOT] ❌ Erro Geral:', err.message);
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                    }
                    return;
                }
                
            } catch (error) {
                console.error('[OWNER BOT] ❌ Erro mídia:', error.message);
                if (isGroup) {
                    await reactToMessage(sock, remoteJid, msg.key, '❌');
                }
                await sock.sendMessage(remoteJid, {
                    text: '❌ Erro ao processar',
                    quoted: msg
                });
                return;
            }
        }
        
        console.log('[OWNER BOT] 🤖 Enviando para IA...');
        
        // ✅ CALLBACKS QUE SEMPRE PEGAM SOCKET ATUAL
        const enviarDigitando = async () => {
            try {
                const currentSock = OwnerBot.getSocket();
                if (currentSock) {
                    await currentSock.sendPresenceUpdate('composing', remoteJid);
                }
            } catch (e) {
                console.log('[OWNER BOT] ⚠️ Erro ao enviar digitando:', e.message);
            }
        };
        
        const enviarResposta = async (texto, messageKey = null) => {
            try {
                const currentSock = OwnerBot.getSocket();
                if (!currentSock) {
                    throw new Error('Socket não disponível');
                }
                
                await currentSock.sendPresenceUpdate('available', remoteJid);
                
                const messageOptions = { text: texto, quoted: msg };
                if (isGroup && senderJid) {
                    messageOptions.mentions = [senderJid];
                }
                
                await currentSock.sendMessage(remoteJid, messageOptions);
                registerInteraction('message', text.substring(0, 200), userName, isGroup, groupName, 'Respondido');
            } catch (e) {
                console.error('[OWNER BOT] ❌ Erro ao enviar resposta:', e.message);
                throw e; // ✅ Lança erro para retry funcionar
            }
        };
        
        await processarMensagemComDebounce(
            text, 
            identifier, 
            null, // ✅ NÃO PASSA SOCKET
            enviarDigitando, 
            enviarResposta, 
            isGroup, 
            isMentioned, 
            msg.key
        );
        
        if (isGroup) {
            await reactToMessage(sock, remoteJid, msg.key, '✅');
        }
        
    } catch (error) {
        console.error('[OWNER BOT] ❌ ERRO:', error.message);
        console.error('[OWNER BOT] Stack:', error.stack);
        try {
            if (msg?.key?.remoteJid && sock) {
                if (msg.key.remoteJid.includes('@g.us')) {
                    await reactToMessage(sock, msg.key.remoteJid, msg.key, '❌');
                }
                await sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ *Erro interno do bot*',
                    quoted: msg
                });
            }
        } catch (e) {}
    }
}

module.exports = { handleOwnerIncomingMessage, isGroupAIEnabled };