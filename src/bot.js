// backend/src/bot.js
const { makeWASocket, useMultiFileAuthState, jidDecode, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { PrismaClient } = require('@prisma/client');
const { parse, isValid, format, startOfDay, endOfDay } = require('date-fns');
const qrcode = require('qrcode-terminal');
const { gerarRespostaIA } = require('./services/ai.service'); 
const { calcularHorariosLivres } = require('./utils/date.util');

const prisma = new PrismaClient();
let sock;
const userStates = {}; 

const CATEGORIAS = ['Barbearia', 'Salão de Beleza', 'Manicure', 'Estética'];

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ["Markaí", "Chrome", "1.0.0"],
        msgRetryCounterCache: new Map(),
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 10000,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('[Bot] Escaneie o QR Code abaixo:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('[Bot] Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('[Bot] Sistema Iniciado e Pronto! 🚀');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const remoteJid = msg.key.remoteJid;

        // 1. BLOQUEIO DE GRUPOS E STATUS
        if (remoteJid === 'status@broadcast') return;
        if (remoteJid.endsWith('@g.us')) return; 

        // 2. DETECÇÃO DE INTERVENÇÃO HUMANA (Se VOCÊ mandar mensagem)
        if (msg.key.fromMe) {
            // Se eu (humano) mandei mensagem, PAUSA o bot para esse cliente
            if (!userStates[remoteJid]) userStates[remoteJid] = {};
            userStates[remoteJid].isIgnored = true; 
            console.log(`[Bot] 🛑 Pausado para ${remoteJid} (Humano assumiu).`);
            return;
        }

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (!text) return;

        const jid = remoteJid;
        const msgLower = text.toLowerCase().trim();

        // Inicializa estado
        if (!userStates[jid]) userStates[jid] = { step: 'INICIO', isIgnored: false, hasTalked: false };
        const state = userStates[jid];

        // 3. LOGICA DE MUDO/RETORNO
        if (state.isIgnored) {
            // Só volta se o cliente disser palavras chave
            if (msgLower === '1' || msgLower.includes('agendar') || msgLower.includes('bot') || msgLower.includes('voltar')) {
                state.isIgnored = false;
                state.step = 'INICIO';
                await enviarMensagem(jid, '🤖 Opa! O Robô voltou. Vamos agendar? Digite "1" para ver as categorias.');
            }
            return; // Se não falou a palavra chave, continua mudo
        }

        // ============================================================
        // FLUXO DO BOT
        // ============================================================

        if (state.step === 'INICIO') {
            if (msgLower === '1' || msgLower.includes('agendar') || msgLower.includes('marcar')) {
                state.hasTalked = true;
                iniciarAgendamento(jid);
                return;
            }

            const clienteProvavel = await prisma.user.findFirst({ 
                where: { OR: [{ phone: { contains: jid.replace(/\D/g, '') } }] } 
            });

            const respostaIA = await gerarRespostaIA(text, {
                nomeUsuario: clienteProvavel ? clienteProvavel.name : 'Visitante',
                agendamentos: clienteProvavel ? await buscarAgendamentos(clienteProvavel.id) : []
            });

            if (respostaIA.includes('[ENCERRAR]')) {
                state.isIgnored = true;
                await enviarMensagem(jid, 'Entendi. Vou ficar silenciado aqui. Se precisar de mim, digite "Agendar" ou "Bot". 👋');
                return;
            }

            state.hasTalked = true;
            await enviarMensagem(jid, respostaIA);
            return;
        }

        // --- MÁQUINA DE ESTADOS (AGENDAMENTO) ---

        if (state.step === 'CONFIRMA_DUPLICIDADE') {
            if (msgLower === 'sim') { iniciarAgendamento(jid); } 
            else { await enviarMensagem(jid, 'Combinado. Agendamento cancelado.'); userStates[jid].step = 'INICIO'; }
            return;
        }

        if (state.step === 'ESCOLHER_CATEGORIA') {
            const index = parseInt(msgLower) - 1;
            if (isNaN(index) || !CATEGORIAS[index]) { await enviarMensagem(jid, '❌ Opção inválida.'); return; }
            const categoria = CATEGORIAS[index];
            const empresas = await prisma.user.findMany({ where: { type: 'PROFESSIONAL', companyName: { not: null } }, take: 10 });
            const filtradas = empresas.filter(e => (e.description && e.description.includes(categoria)) || (e.companyName && e.companyName.includes(categoria)) || true);

            if (filtradas.length === 0) { await enviarMensagem(jid, 'Nenhuma empresa encontrada.'); userStates[jid].step = 'INICIO'; return; }
            userStates[jid].listaEmpresas = filtradas;
            userStates[jid].step = 'ESCOLHER_EMPRESA';
            let menu = `🏢 *Empresas de ${categoria}:*\n\n`;
            filtradas.forEach((e, i) => menu += `${i + 1}. *${e.companyName}*\n`);
            menu += '\nDigite o número da empresa:';
            await enviarMensagem(jid, menu);
            return;
        }

        if (state.step === 'ESCOLHER_EMPRESA') {
            const index = parseInt(msgLower) - 1;
            const empresas = userStates[jid].listaEmpresas;
            if (isNaN(index) || !empresas[index]) { await enviarMensagem(jid, '❌ Inválido.'); return; }
            userStates[jid].empresaId = empresas[index].id;
            userStates[jid].empresaNome = empresas[index].companyName;
            userStates[jid].step = 'DIGITAR_DATA_DIA';
            await enviarMensagem(jid, `✅ *${empresas[index].companyName}*.\nPara qual dia? (Ex: 25/10)`);
            return;
        }

        if (state.step === 'DIGITAR_DATA_DIA') {
            try {
                const hoje = new Date();
                const partes = text.split('/');
                if (partes.length < 2) throw new Error();
                const dataQuery = new Date(hoje.getFullYear(), parseInt(partes[1]) - 1, parseInt(partes[0]));
                if (dataQuery < startOfDay(hoje)) { await enviarMensagem(jid, '⚠️ Data passada.'); return; }

                const profissional = await prisma.user.findUnique({ where: { id: userStates[jid].empresaId } });
                const ocupados = await prisma.appointment.findMany({ where: { proId: userStates[jid].empresaId, date: { gte: startOfDay(dataQuery), lte: endOfDay(dataQuery) }, status: { not: 'CANCELED' } } });
                
                const slotsLivres = calcularHorariosLivres(dataQuery, ocupados, { workStart: profissional.workStart, workEnd: profissional.workEnd, serviceDuration: profissional.serviceDuration });
                if (slotsLivres.length === 0) { await enviarMensagem(jid, '😔 Lotado.'); return; }
                
                userStates[jid].slotsDisponiveis = slotsLivres;
                userStates[jid].step = 'ESCOLHER_HORARIO';
                let menuHorarios = `📅 *Horários para ${format(dataQuery, 'dd/MM')}:*\n\n`;
                slotsLivres.forEach((slot, i) => { menuHorarios += `${i + 1}. 🕒 ${format(slot, 'HH:mm')}\n`; });
                menuHorarios += '\nDigite o número do horário:';
                await enviarMensagem(jid, menuHorarios);
            } catch (e) { await enviarMensagem(jid, '⚠️ Formato inválido. Ex: 25/10'); }
            return;
        }

        if (state.step === 'ESCOLHER_HORARIO') {
            const index = parseInt(msgLower) - 1;
            const slots = userStates[jid].slotsDisponiveis;
            if (isNaN(index) || !slots[index]) { await enviarMensagem(jid, '❌ Inválido.'); return; }
            userStates[jid].dataFinal = slots[index];
            userStates[jid].step = 'VERIFICAR_CPF';
            await enviarMensagem(jid, '🔒 Digite seu CPF (apenas números):');
            return;
        }

        if (state.step === 'VERIFICAR_CPF') {
            const cpfInput = text.replace(/\D/g, ''); 
            if (cpfInput.length < 11) { await enviarMensagem(jid, '⚠️ CPF inválido.'); return; }
            const usuarioExistente = await prisma.user.findFirst({ where: { cpf: cpfInput } });

            if (usuarioExistente) {
                const duplicidade = await checarDuplicidade(usuarioExistente.id);
                if (duplicidade) {
                    await enviarMensagem(jid, `⚠️ Você já tem agendamento. Digite SIM para marcar outro ou NÃO para cancelar.`);
                    userStates[jid].tempUserConfirm = usuarioExistente;
                    userStates[jid].step = 'CONFIRMA_DUPLICIDADE_FINAL';
                    return;
                }
                await finalizarAgendamento(jid, usuarioExistente.id, usuarioExistente.name, usuarioExistente.phone);
            } else {
                userStates[jid].cpfTemporario = cpfInput;
                userStates[jid].step = 'CADASTRO_NOME_NOVO';
                await enviarMensagem(jid, '📝 Qual seu Nome Completo?');
            }
            return;
        }

        if (state.step === 'CONFIRMA_DUPLICIDADE_FINAL') {
            if (msgLower === 'sim') { 
                const u = userStates[jid].tempUserConfirm; 
                await finalizarAgendamento(jid, u.id, u.name, u.phone); 
            } else { 
                await enviarMensagem(jid, 'Cancelado.'); userStates[jid].step = 'INICIO'; 
            }
            return;
        }

        if (state.step === 'CADASTRO_NOME_NOVO') {
            userStates[jid].nomeTemporario = text.trim();
            userStates[jid].step = 'CADASTRO_TELEFONE';
            await enviarMensagem(jid, `Prazer! Digite seu WhatsApp com DDD:`);
            return;
        }

        if (state.step === 'CADASTRO_TELEFONE') {
            let tel = text.replace(/\D/g, ''); 
            if (tel.length <= 11) tel = '55' + tel;
            try {
                const novoUser = await prisma.user.create({ data: { name: userStates[jid].nomeTemporario, phone: tel, cpf: userStates[jid].cpfTemporario, email: `${userStates[jid].cpfTemporario}@markai.bot`, password: 'bot', type: 'CLIENT' } });
                await finalizarAgendamento(jid, novoUser.id, novoUser.name, tel);
            } catch (e) { await enviarMensagem(jid, 'Erro ao cadastrar.'); userStates[jid].step = 'INICIO'; }
            return;
        }
    });
}

// --- HELPERS ---
async function iniciarAgendamento(jid) {
    let menu = '👋 *Agendamento Markaí*\nEscolha a categoria:\n\n';
    CATEGORIAS.forEach((cat, i) => menu += `${i + 1}. ${cat}\n`);
    userStates[jid].step = 'ESCOLHER_CATEGORIA';
    await enviarMensagem(jid, menu);
}

async function checarDuplicidade(userId) {
    const agendamentos = await prisma.appointment.findMany({ where: { clientId: userId, status: { in: ['PENDING', 'CONFIRMED'] }, date: { gte: new Date() } } });
    return agendamentos.length > 0 ? agendamentos[0] : null;
}

async function finalizarAgendamento(jid, userId, nomeUsuario, telefoneReal) {
    const state = userStates[jid];
    try {
        await prisma.appointment.create({ data: { clientId: userId, proId: state.empresaId, date: state.dataFinal, status: 'PENDING' } });
        const dataF = format(state.dataFinal, "dd/MM 'às' HH:mm");
        await enviarMensagem(jid, `✅ *AGENDAMENTO SOLICITADO!* 🎉\n\nData: ${dataF}\nLocal: ${state.empresaNome}\n\nAguarde confirmação.`);
        userStates[jid].step = 'INICIO';
    } catch (e) { await enviarMensagem(jid, 'Erro ao salvar.'); userStates[jid].step = 'INICIO'; }
}

async function buscarAgendamentos(clienteId) {
    return await prisma.appointment.findMany({ where: { clientId: clienteId, status: { in: ['PENDING', 'CONFIRMED'] } }, include: { professional: true } });
}

async function enviarMensagem(destino, texto) {
    if (!sock) return;
    try {
        let jidFinal = destino;
        if (!destino.includes('@')) { const apenasNumeros = destino.replace(/\D/g, ''); jidFinal = `${apenasNumeros}@s.whatsapp.net`; }
        if (jidFinal.endsWith('@g.us')) return; 
        
        await sock.sendPresenceUpdate('composing', jidFinal);
        await new Promise(r => setTimeout(r, 500));
        await sock.sendMessage(jidFinal, { text: texto });
        await sock.sendPresenceUpdate('paused', jidFinal);
    } catch (e) { console.log('Erro envio:', e.message); }
}

module.exports = { startBot, enviarMensagem };