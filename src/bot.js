// backend/src/bot.js
const { PrismaClient } = require('@prisma/client');
const { gerarRespostaProfissional, registrarSocket } = require('./services/ai.service');

const prisma = new PrismaClient();
const chatStates = {}; 

async function handleIncomingMessage(msg, sessionId, sock) {
    try {
        console.log('\n' + '='.repeat(70));
        console.log('[BOT] 📨 NOVA MENSAGEM RECEBIDA');
        console.log('='.repeat(70));
        
        // ✅ EXTRAI O professionalId CORRETAMENTE
        let professionalId = sessionId;
        if (sessionId.startsWith('session_')) {
            professionalId = sessionId.replace('session_', '');
        }
        
        console.log('[BOT] SessionId recebido:', sessionId);
        console.log('[BOT] ProfessionalId extraído:', professionalId);
        
        // ✅ REGISTRA SOCKET PARA NOTIFICAÇÕES
        registrarSocket(professionalId, sock);
        
        console.log('[BOT] Mensagem completa:', JSON.stringify(msg, null, 2));
        
        // ✅ VALIDAÇÕES DE SEGURANÇA
        if (!msg) {
            console.log('[BOT] ❌ Mensagem inválida (null/undefined)');
            return;
        }

        console.log('[BOT] ✅ Mensagem válida, verificando propriedades...');

        if (msg.key?.fromMe) {
            console.log('[BOT] 🧑‍💼 Profissional enviou mensagem — assumindo conversa');

            const remoteJid = msg.key.remoteJid;
            const phoneNumber = remoteJid.split('@')[0];

            if (!chatStates[professionalId]) {
                chatStates[professionalId] = {};
            }

            if (!chatStates[professionalId][remoteJid]) {
                chatStates[professionalId][remoteJid] = {
                    historico: [],
                    clienteId: phoneNumber
                };
            }

            // 🔥 MARCA COMO ASSUMIDO
            chatStates[professionalId][remoteJid].assumidoPorHumano = true;

            return; // IA NÃO RESPONDE
        }


        console.log('[BOT] ✅ Não é mensagem própria');

        // ✅ Ignora grupos
        if (msg.key?.remoteJid?.includes('@g.us')) {
            console.log('[BOT] ⏭️ Mensagem de grupo, ignorando');
            return;
        }

        console.log('[BOT] ✅ Não é mensagem de grupo');

        // ✅ Ignora mensagens de broadcast/status
        if (!msg.key?.remoteJid || msg.key.remoteJid === 'status@broadcast') {
            console.log('[BOT] ⏭️ Mensagem de status/broadcast, ignorando');
            return;
        }

        console.log('[BOT] ✅ Não é broadcast');

        const remoteJid = msg.key.remoteJid;
        console.log('[BOT] 📱 RemoteJid:', remoteJid);

        // ✅ Extrai texto da mensagem
        let text = '';
        
        if (msg.message?.conversation) {
            text = msg.message.conversation;
            console.log('[BOT] 📝 Texto extraído de conversation');
        } else if (msg.message?.extendedTextMessage?.text) {
            text = msg.message.extendedTextMessage.text;
            console.log('[BOT] 📝 Texto extraído de extendedTextMessage');
        } else if (msg.message?.imageMessage?.caption) {
            text = msg.message.imageMessage.caption;
            console.log('[BOT] 📝 Texto extraído de imageMessage caption');
        }

        console.log('[BOT] 💬 Texto da mensagem:', text);

        if (!text || text.trim() === '') {
            console.log('[BOT] ⏭️ Mensagem sem texto, ignorando');
            return;
        }

        console.log('\n[BOT] ✅ MENSAGEM VÁLIDA PARA PROCESSAR');
        console.log('[BOT] De:', remoteJid);
        console.log('[BOT] Texto:', text);
        console.log('[BOT] ProfissionalId:', professionalId);

        // Extrai número de telefone
        const phoneNumber = remoteJid.split('@')[0];
        console.log('[BOT] 📞 Telefone extraído:', phoneNumber);

        // Inicializa estado do chat
        if (!chatStates[professionalId]) {
            chatStates[professionalId] = {};
            console.log('[BOT] 🆕 Criado estado para profissional:', professionalId);
        }
        
        if (!chatStates[professionalId][remoteJid]) {
            chatStates[professionalId][remoteJid] = { 
                historico: [],
                clienteId: phoneNumber
            };
            console.log('[BOT] 🆕 Criado estado para cliente:', remoteJid);
        }

        const state = chatStates[professionalId][remoteJid];
        state.historico.push({ role: 'user', content: text, clienteId: phoneNumber });
        
        // Mantém apenas últimas 10 mensagens
        if (state.historico.length > 10) {
            state.historico.shift();
        }

        console.log('[BOT] 📚 Histórico tem', state.historico.length, 'mensagens');

        // Mostra "digitando..."
        try {
            console.log('[BOT] ⌨️ Enviando presença "composing"...');
            await sock.sendPresenceUpdate('composing', remoteJid);
            console.log('[BOT] ✅ Presença enviada');
        } catch (e) {
            console.log('[BOT] ⚠️ Erro ao enviar presença:', e.message);
        }

        // ✅ BUSCA DADOS DO PROFISSIONAL
        console.log('[BOT] 🔍 Buscando profissional com ID:', professionalId);
        const professional = await prisma.user.findUnique({
            where: { id: professionalId },
            include: { 
                services: true, 
                appointmentsAsPro: { 
                    where: { 
                        date: { gte: new Date() },
                        status: { not: 'CANCELED' }
                    },
                    select: { date: true } 
                }
            }
        });

        if (!professional) {
            console.log('[BOT] ❌ Profissional não encontrado com ID:', professionalId);
            await sock.sendMessage(remoteJid, { 
                text: '❌ *Erro de configuração*\n\nO bot não está configurado corretamente.\n\nPeça ao profissional para reconectar o WhatsApp.' 
            });
            return;
        }

        console.log('[BOT] ✅ Profissional encontrado:', professional.name || professional.companyName);
        console.log('[BOT] 📋 Serviços:', professional.services?.length || 0);
        console.log('[BOT] 📅 Agendamentos futuros:', professional.appointmentsAsPro?.length || 0);

        // Gera resposta da IA
        console.log('[BOT] 🤖 Gerando resposta da IA...');
        const respostaIA = await gerarRespostaProfissional(text, {
            profissionalNome: professional.companyName || professional.name,
            servicos: professional.services,
            agendaOcupada: professional.appointmentsAsPro,
            horarioTrabalho: { 
                start: professional.workStart || "08:00", 
                end: professional.workEnd || "18:00" 
            },
            duracaoServico: professional.serviceDuration || 60,
            professionalId: professionalId
        }, state.historico, phoneNumber);

        // ✅ SE IA RETORNAR NULL, NÃO ENVIA NADA (ESTÁ MUDA)
        if (respostaIA === null || respostaIA === undefined) {
            console.log('[BOT] 🔇 IA está muda, não enviando resposta');
            console.log('='.repeat(70) + '\n');
            return;
        }

        console.log('[BOT] 💡 Resposta gerada:', respostaIA.substring(0, 100) + '...');

        // Envia resposta
        console.log('[BOT] 📤 Enviando resposta...');
        await sock.sendMessage(remoteJid, { text: respostaIA });
        
        // Salva no histórico
        state.historico.push({ role: 'assistant', content: respostaIA });

        console.log('[BOT] ✅ RESPOSTA ENVIADA COM SUCESSO!');
        console.log('='.repeat(70) + '\n');

    } catch (error) {
        console.error('\n' + '❌'.repeat(35));
        console.error('[BOT] ERRO CRÍTICO ao processar mensagem:');
        console.error('Mensagem:', error.message);
        console.error('Stack:', error.stack);
        console.error('❌'.repeat(35) + '\n');
        
        // Tenta enviar mensagem de erro ao usuário
        try {
            if (msg?.key?.remoteJid && sock) {
                await sock.sendMessage(msg.key.remoteJid, { 
                    text: '❌ *Erro ao processar*\n\nDesculpe, houve um problema.\n\nTente novamente em instantes.' 
                });
            }
        } catch (e) {
            console.error('[BOT] ❌ Erro ao enviar mensagem de erro:', e.message);
        }
    }
}

module.exports = { handleIncomingMessage };