// backend/src/bot.js
const { PrismaClient } = require('@prisma/client');
const { gerarRespostaProfissional } = require('./services/ai.service'); // A função de IA que criamos antes

const prisma = new PrismaClient();

// Armazena histórico da conversa: { 'ID_PROFISSIONAL': { 'NUMERO_CLIENTE': [] } }
const chatStates = {}; 

async function handleIncomingMessage(msg, professionalId, client) {
    // 1. Filtros de Segurança
    if (msg.fromMe) return; // Ignora mensagens enviadas pelo próprio profissional
    if (msg.from.includes('@g.us')) return; // Ignora Grupos (opcional)

    const contact = await msg.getContact();
    const text = msg.body;
    const remoteJid = msg.from; // Número do cliente

    console.log(`[Bot Pro ${professionalId}] msg de ${remoteJid}: ${text}`);

    // 2. Gerenciamento de Estado (Histórico)
    if (!chatStates[professionalId]) chatStates[professionalId] = {};
    if (!chatStates[professionalId][remoteJid]) {
        chatStates[professionalId][remoteJid] = { historico: [] };
    }

    const state = chatStates[professionalId][remoteJid];
    
    // Adiciona msg do usuário ao histórico
    state.historico.push({ role: 'user', content: text });
    if (state.historico.length > 10) state.historico.shift();

    try {
        // Simula "Digitando..."
        const chat = await msg.getChat();
        await chat.sendStateTyping();

        // 3. BUSCAR DADOS DO PROFISSIONAL NO BANCO
        // Aqui garantimos que o bot responda APENAS sobre este profissional
        const professional = await prisma.user.findUnique({
            where: { id: professionalId },
            include: { 
                services: true, // Pega o catálogo
                appointments: { // Pega agenda futura para checar conflitos básicos
                    where: { 
                        date: { gte: new Date() },
                        status: { not: 'CANCELED' }
                    },
                    select: { date: true } // Traz só as datas ocupadas para economizar memória
                }
            }
        });

        if (!professional) {
            console.log("Profissional não encontrado no banco.");
            return;
        }

        // 4. CHAMAR A IA
        // A IA recebe o contexto específico deste profissional
        const respostaIA = await gerarRespostaProfissional(text, {
            profissionalNome: professional.companyName || professional.name,
            servicos: professional.services,
            agendaOcupada: professional.appointments,
            horarioTrabalho: { start: professional.workStart || "08:00", end: professional.workEnd || "18:00" }
        }, state.historico);

        // 5. RESPONDER NO WHATSAPP
        await client.sendMessage(remoteJid, respostaIA);
        await chat.clearState(); // Para de "digitar"

        // Salva resposta da IA no histórico
        state.historico.push({ role: 'assistant', content: respostaIA });

    } catch (error) {
        console.error(`Erro ao processar mensagem para ${professionalId}:`, error);
    }
}

module.exports = { handleIncomingMessage };