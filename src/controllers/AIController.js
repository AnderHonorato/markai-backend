const { PrismaClient } = require('@prisma/client'); 
const axios = require('axios'); 

// ✅ GARANTE QUE O DOTENV ESTÁ CARREGADO
require('dotenv').config();

const prisma = new PrismaClient(); 

// ✅ CARREGA CORRETAMENTE DO .env
const SPIDER_API_TOKEN = process.env.SPIDER_API_TOKEN;
const SPIDER_API_BASE_URL = 'https://api.spiderx.com.br/api/ai/gemini'; 

// ✅ VALIDAÇÃO NO INÍCIO DO ARQUIVO
if (!SPIDER_API_TOKEN) {
    console.error('⚠️ [ERRO CRÍTICO] SPIDER_API_TOKEN não encontrado no .env');
    console.error('⚠️ Verifique se o arquivo .env existe e contém: SPIDER_API_TOKEN=sua_key_aqui');
} else {
    console.log('✅ [Spider X] API Token carregado com sucesso');
}

const chatStates = {}; 
const MAX_STATES = 500;

module.exports = { 
    async chat(req, res) { 
        try { 
            const { userId, message } = req.body; 
             
            console.log('[AIController - App] Nova mensagem'); 
            console.log('[AIController - App] UserId:', userId); 
            console.log('[AIController - App] Mensagem:', message); 
 
            if (!userId || !message) { 
                return res.status(400).json({ error: 'userId e message são obrigatórios' }); 
            } 
 
            const user = await prisma.user.findUnique({ 
                where: { id: userId }, 
                include: { 
                    services: true, 
                    appointmentsAsClient: { 
                        include: { professional: { include: { services: true } } }, 
                        orderBy: { date: 'desc' } 
                    }, 
                    appointmentsAsPro: { 
                        include: { client: true }, 
                        orderBy: { date: 'desc' } 
                    }, 
                    cashRegisters: true, 
                    reviewsReceived: true 
                } 
            }); 
 
            if (!user) { 
                return res.status(404).json({ error: 'Usuário não encontrado' }); 
            } 
 
            const isProfessional = user.type === 'PROFESSIONAL'; 
            const isClient = user.type === 'CLIENT'; 
 
            if (isProfessional) { 
                const response = await handleProfessionalChat(user, message, userId); 
                return res.json({ response }); 
            } 
 
            if (isClient) { 
                const response = await handleClientChat(user, message, userId); 
                return res.json({ response }); 
            } 
 
            return res.json({ response: "Olá! 👋 Sou a Markaí.\n\nParece que seu cadastro está incompleto." }); 
 
        } catch (error) { 
            console.error('[AIController - App] Erro:', error.message); 
            return res.status(500).json({ error: 'Erro ao processar mensagem', details: error.message }); 
        } 
    } 
}; 
 
async function handleProfessionalChat(user, message, userId) { 
    const msgLower = message.toLowerCase().trim(); 
     
    if (!chatStates[userId]) { 
        if (Object.keys(chatStates).length > MAX_STATES) {
            delete chatStates[Object.keys(chatStates)[0]];
        }
        chatStates[userId] = { historico: [], primeiraInteracao: true, lastActive: Date.now() }; 
    } 
    chatStates[userId].lastActive = Date.now();
     
    const estado = chatStates[userId]; 
    
    // 🔥 PRIMEIRA MENSAGEM - RESPOSTA FIXA DO SISTEMA
    if (estado.primeiraInteracao) {
        estado.primeiraInteracao = false;
        
        const agendamentosAtivos = user.appointmentsAsPro?.filter(a => 
            new Date(a.date) >= new Date() && !['CANCELED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(a.status)
        ).length || 0;
        
        return `👋 Olá! Sou a **Markaí**, sua assistente virtual.

${user.companyName || user.name} tem **${agendamentosAtivos}** agendamento${agendamentosAtivos !== 1 ? 's' : ''} ativo${agendamentosAtivos !== 1 ? 's' : ''}.

Posso ajudar com:
• Estatísticas (faturamento, clientes)
• Dúvidas sobre o sistema
• Configurações

Como posso ajudar?`;
    }
    
    const periodo = detectarPeriodo(msgLower); 
     
    if (msgLower.includes('concluido') || msgLower.includes('finalizado')) { 
        return await gerarEstatisticasAgendamentos(user, periodo, 'COMPLETED'); 
    } 
     
    if (msgLower.includes('pendente') || msgLower.includes('ativo')) { 
        return await gerarEstatisticasAgendamentos(user, periodo, 'PENDING'); 
    } 
     
    if (msgLower.includes('cancelado')) { 
        return await gerarEstatisticasAgendamentos(user, periodo, 'CANCELED'); 
    } 
     
    if (msgLower.includes('cliente') && (msgLower.includes('quanto') || msgLower.includes('total'))) { 
        return await gerarEstatisticasClientes(user, periodo); 
    } 
     
    if (msgLower.includes('faturamento') || msgLower.includes('receita') || msgLower.includes('ganho')) { 
        return await gerarEstatisticasFaturamento(user, periodo); 
    } 
     
    if (msgLower.includes('mais realizado') || msgLower.includes('popular')) { 
        return await gerarServicoMaisRealizado(user, periodo); 
    } 
     
    if (msgLower.includes('relatorio') || msgLower.includes('resumo')) { 
        return await gerarRelatorioGeral(user, periodo); 
    } 
     
    return await conversarComSpiderX(message, user, estado.historico, 'PROFESSIONAL'); 
} 
 
async function handleClientChat(user, message, userId) { 
    const msgLower = message.toLowerCase().trim(); 
     
    if (!chatStates[userId]) { 
        if (Object.keys(chatStates).length > MAX_STATES) {
            delete chatStates[Object.keys(chatStates)[0]];
        }
        chatStates[userId] = { etapa: 'CONVERSANDO', historico: [], categoria: null, profissionaisFiltrados: [], primeiraInteracao: true, lastActive: Date.now() }; 
    } 
    chatStates[userId].lastActive = Date.now();
     
    const estado = chatStates[userId]; 
    
    // 🔥 PRIMEIRA MENSAGEM - RESPOSTA FIXA DO SISTEMA
    if (estado.primeiraInteracao) {
        estado.primeiraInteracao = false;
        
        const ativos = user.appointmentsAsClient?.filter(a => 
            new Date(a.date) >= new Date() && !['CANCELED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(a.status)
        ).length || 0;
        
        return `👋 Olá, **${user.name}**! Sou a **Markaí**.

Você tem **${ativos}** agendamento${ativos !== 1 ? 's' : ''} ativo${ativos !== 1 ? 's' : ''}.

Digite **"agendar"** para buscar profissionais! 😊`;
    }
     
    if (msgLower.includes('agendar') || msgLower.includes('marcar') || msgLower.includes('buscar')) { 
        estado.etapa = 'ESCOLHENDO_CATEGORIA'; 
         
        const categorias = await prisma.user.findMany({ 
            where: { type: 'PROFESSIONAL', isAccountActive: true }, 
            select: { mainCategory: true }, 
            distinct: ['mainCategory'] 
        }); 
         
        let resposta = `🔍 **Encontrar Profissional**\n\n📋 Escolha:\n\n`; 
        categorias.forEach((cat, i) => { resposta += `${i + 1}. ${cat.mainCategory}\n`; }); 
        resposta += `\nDigite o número`; 
        estado.categoriasDisponiveis = categorias.map(c => c.mainCategory); 
        return resposta; 
    } 
     
    if (estado.etapa === 'ESCOLHENDO_CATEGORIA') { 
        const escolha = parseInt(message); 
        if (isNaN(escolha) || escolha < 1 || escolha > estado.categoriasDisponiveis.length) { 
            return `❌ Número inválido\n\nEscolha de 1 a ${estado.categoriasDisponiveis.length}`; 
        } 
        estado.categoria = estado.categoriasDisponiveis[escolha - 1]; 
        estado.etapa = 'COLETANDO_LOCALIZACAO'; 
        return `✅ ${estado.categoria}\n\n📍 Digite sua cidade:\n\nEx: Salvador, São Paulo`; 
    } 
     
    if (estado.etapa === 'COLETANDO_LOCALIZACAO') { 
        estado.localizacao = message.trim(); 
         
        const profissionais = await prisma.user.findMany({ 
            where: { type: 'PROFESSIONAL', mainCategory: estado.categoria, isAccountActive: true }, 
            include: { services: true, appointmentsAsPro: { where: { status: 'COMPLETED' } } }, 
            take: 10 
        }); 
         
        if (profissionais.length === 0) { 
            delete chatStates[userId]; 
            return `😔 Nenhum profissional de ${estado.categoria} encontrado.\n\nTente outra categoria!`; 
        } 
         
        estado.profissionaisFiltrados = profissionais; 
        estado.etapa = 'ESCOLHENDO_PROFISSIONAL'; 
         
        let resposta = `🎯 ${profissionais.length} profissional${profissionais.length > 1 ? 'is' : ''}!\n\n`; 
        profissionais.slice(0, 5).forEach((pro, i) => { 
            const nota = pro.reputationScore?.toFixed(1) || '5.0'; 
            const cidade = pro.city || 'Não informado'; 
            resposta += `${i + 1}. ${pro.companyName || pro.name}\n   📍 ${cidade}\n   ⭐ ${nota} (${pro.totalReviews || 0})\n   💼 ${pro.services?.length || 0} serviços\n\n`; 
        }); 
        resposta += `Digite o número`; 
        return resposta; 
    } 
     
    if (estado.etapa === 'ESCOLHENDO_PROFISSIONAL') { 
        const escolha = parseInt(message); 
        if (isNaN(escolha) || escolha < 1 || escolha > estado.profissionaisFiltrados.length) { 
            return `❌ Número inválido\n\nEscolha de 1 a ${estado.profissionaisFiltrados.length}`; 
        } 
         
        const profissional = estado.profissionaisFiltrados[escolha - 1]; 
        delete chatStates[userId]; 
         
        return JSON.stringify({ 
            intent: "SELECT_PROFESSIONAL", 
            message: `✅ ${profissional.companyName || profissional.name}\n\nVeja os serviços e agende!`, 
            proId: profissional.id, 
            proName: profissional.companyName || profissional.name 
        }); 
    } 
     
    return await conversarComSpiderX(message, user, estado.historico, 'CLIENT'); 
} 
 
async function conversarComSpiderX(mensagem, user, historico, tipoUsuario) { 
    try {
        // ✅ VALIDAÇÃO SE TEM API TOKEN
        if (!SPIDER_API_TOKEN) {
            console.error('[Spider X] SPIDER_API_TOKEN não configurado no .env');
            const isProfessional = tipoUsuario === 'PROFESSIONAL';
            return isProfessional 
                ? `Desculpe, estou com problemas técnicos no momento. Tente novamente em instantes! 🔧` 
                : `Ops, estou com problemas técnicos. Tente novamente! 🔧`;
        }

        const isProfessional = tipoUsuario === 'PROFESSIONAL'; 
        let promptSistema = ''; 
         
        if (isProfessional) { 
            const agendamentosAtivos = user.appointmentsAsPro?.filter(a =>  
                new Date(a.date) >= new Date() && !['CANCELED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(a.status) 
            ).length || 0; 
             
            promptSistema = `Você é Markaí, assistente do profissional.

CONTEXTO:
- ${user.companyName || user.name}
- ${agendamentosAtivos} agendamento${agendamentosAtivos !== 1 ? 's' : ''} ativo${agendamentosAtivos !== 1 ? 's' : ''}
- ${user.services?.length || 0} serviços cadastrados

SUA FUNÇÃO:
- Conversar naturalmente sobre o negócio
- Tirar dúvidas do sistema
- Se perguntarem dados/estatísticas: "Vou buscar para você! 📊"
- Adaptar-se ao contexto da conversa

REGRAS:
1. Responda em 150-250 caracteres
2. Use 1 emoji quando apropriado
3. Seja profissional mas amigável
4. SEMPRE termine frases completas
5. Responda o que foi perguntado

PROIBIDO:
- Textos robóticos ou genéricos
- Repetir sempre as mesmas frases
- Ignorar o contexto`;
        } else { 
            const ativos = user.appointmentsAsClient?.filter(a =>  
                new Date(a.date) >= new Date() && !['CANCELED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(a.status) 
            ).length || 0; 
             
            promptSistema = `Você é Markaí, assistente amigável do app.

CONTEXTO:
- Cliente: ${user.name}
- ${ativos} agendamento${ativos !== 1 ? 's' : ''} ativo${ativos !== 1 ? 's' : ''}

SUA FUNÇÃO:
- Conversar naturalmente
- Ajudar com dúvidas do app
- Se perguntarem sobre agendar/buscar profissionais: mencione "digite 'agendar'"
- NUNCA force o assunto de agendar se não for relevante

REGRAS:
1. Responda em 150-250 caracteres
2. Use 1 emoji quando apropriado
3. Seja natural e simpática
4. SEMPRE termine frases completas
5. Adapte-se ao contexto da conversa

PROIBIDO:
- Repetir "digite agendar" em toda resposta
- Textos longos ou robóticos
- Ignorar o que o usuário disse`;
        } 
         
        const msgLimitada = mensagem.substring(0, 150); 
        
        // Contexto das últimas mensagens
        let contexto = '';
        if (historico.length > 0) {
            const ultimasMsg = historico.slice(-2);
            ultimasMsg.forEach(h => {
                const label = h.role === 'user' ? 'Usuário' : 'Você';
                contexto += `${label}: ${h.content.substring(0, 80)}\n`;
            });
        }
         
        const prompt = `${promptSistema}\n\nCONVERSA ANTERIOR:\n${contexto}\nUSUÁRIO AGORA: ${msgLimitada}\n\nRESPONDA:`; 
         
        console.log('[Spider X] Enviando para API... (tamanho:', prompt.length, ')'); 
         
        const response = await axios.post(
            `${SPIDER_API_BASE_URL}?api_key=${SPIDER_API_TOKEN}`, 
            { text: prompt }, 
            { timeout: 12000 }
        ); 
        
        let resposta = response.data?.response?.trim() || 'Desculpe, não entendi.'; 
        
        // Cortar resposta sem quebrar frases
        if (resposta.length > 300) {
            let corte = resposta.lastIndexOf('.', 300);
            if (corte === -1) corte = resposta.lastIndexOf('!', 300);
            if (corte === -1) corte = resposta.lastIndexOf('?', 300);
            
            if (corte > 150) {
                resposta = resposta.substring(0, corte + 1);
            } else {
                resposta = resposta.substring(0, 297) + '...';
            }
        }
         
        historico.push({ role: 'user', content: msgLimitada }); 
        historico.push({ role: 'assistant', content: resposta }); 
        if (historico.length > 6) historico.splice(0, historico.length - 6); 
         
        console.log('[Spider X] Resposta OK:', resposta.substring(0, 50) + '...'); 
        return resposta; 
         
    } catch (error) { 
        console.error('[Spider X] Erro:', error.message); 
        if (error.response?.status === 403) {
            console.error('[Spider X] Token inválido ou expirado - Verifique o .env');
        }
        
        return `Desculpe, tive um problema técnico. Tente novamente! 🔧`; 
    } 
} 
 
function detectarPeriodo(msgLower) { 
    if (msgLower.includes('hoje')) return 'today'; 
    if (msgLower.includes('ontem')) return 'yesterday'; 
    if (msgLower.includes('semana')) return 'week'; 
    if (msgLower.includes('mes') || msgLower.includes('mês')) return 'month'; 
    if (msgLower.includes('ano')) return 'year'; 
    return 'all'; 
} 
 
function calcularDataInicio(periodo) { 
    const agora = new Date(); 
    switch (periodo) { 
        case 'today': return new Date(agora.setHours(0, 0, 0, 0)); 
        case 'yesterday': const ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1); return new Date(ontem.setHours(0, 0, 0, 0)); 
        case 'week': const semana = new Date(agora); semana.setDate(semana.getDate() - 7); return semana; 
        case 'month': const mes = new Date(agora); mes.setMonth(mes.getMonth() - 1); return mes; 
        case 'year': const ano = new Date(agora); ano.setFullYear(ano.getFullYear() - 1); return ano; 
        default: return new Date('2020-01-01'); 
    } 
} 
 
function getNomePeriodo(periodo) { 
    const nomes = { 'today': 'hoje', 'yesterday': 'ontem', 'week': 'nos últimos 7 dias', 'month': 'no último mês', 'year': 'no último ano', 'all': 'no total' }; 
    return nomes[periodo] || 'no período'; 
} 
 
async function gerarEstatisticasAgendamentos(user, periodo, status) { 
    const dataInicio = calcularDataInicio(periodo); 
    const agendamentos = user.appointmentsAsPro?.filter(a => a.status === status && new Date(a.date) >= dataInicio) || []; 
    const total = agendamentos.length; 
    const receita = agendamentos.reduce((sum, a) => sum + (a.totalPrice || 0), 0); 
    const nomePeriodo = getNomePeriodo(periodo); 
    const nomeStatus = status === 'COMPLETED' ? 'concluídos' : status === 'PENDING' ? 'pendentes' : 'cancelados'; 
    return `📊 Agendamentos ${nomeStatus}\n\n${nomePeriodo.toUpperCase()}:\n• Total: **${total}**\n• Receita: **R$ ${receita.toFixed(2)}**${total > 0 ? `\n• Ticket médio: R$ ${(receita / total).toFixed(2)}` : ''}`; 
} 
 
async function gerarEstatisticasClientes(user, periodo) { 
    const dataInicio = calcularDataInicio(periodo); 
    const agendamentos = user.appointmentsAsPro?.filter(a => new Date(a.date) >= dataInicio) || []; 
    const clientesUnicos = new Set(agendamentos.map(a => a.clientId)).size; 
    const total = agendamentos.length; 
    const nomePeriodo = getNomePeriodo(periodo); 
    return `👥 Clientes\n\n${nomePeriodo.toUpperCase()}:\n• Clientes únicos: **${clientesUnicos}**\n• Total atendimentos: **${total}**${clientesUnicos > 0 ? `\n• Média: ${(total / clientesUnicos).toFixed(1)} atendimento${total / clientesUnicos > 1 ? 's' : ''}/cliente` : ''}`; 
} 
 
async function gerarEstatisticasFaturamento(user, periodo) { 
    const dataInicio = calcularDataInicio(periodo); 
    const agendamentos = user.appointmentsAsPro?.filter(a => a.status === 'COMPLETED' && new Date(a.date) >= dataInicio) || []; 
    const receita = agendamentos.reduce((sum, a) => sum + (a.totalPrice || 0), 0); 
    const total = agendamentos.length; 
    const nomePeriodo = getNomePeriodo(periodo); 
    return `💰 Faturamento\n\n${nomePeriodo.toUpperCase()}:\n• Receita: **R$ ${receita.toFixed(2)}**\n• Atendimentos: **${total}**${total > 0 ? `\n• Ticket médio: R$ ${(receita / total).toFixed(2)}` : ''}`; 
} 
 
async function gerarServicoMaisRealizado(user, periodo) { 
    const dataInicio = calcularDataInicio(periodo); 
    const agendamentos = user.appointmentsAsPro?.filter(a => a.status === 'COMPLETED' && new Date(a.date) >= dataInicio) || []; 
    const servicos = {}; 
    agendamentos.forEach(a => { const servico = a.serviceList || 'Não especificado'; servicos[servico] = (servicos[servico] || 0) + 1; }); 
    const ordenados = Object.entries(servicos).sort((a, b) => b[1] - a[1]); 
    if (ordenados.length === 0) return `📋 Serviços\n\nNenhum serviço realizado ${getNomePeriodo(periodo)}.`; 
    const nomePeriodo = getNomePeriodo(periodo); 
    let resposta = `📋 Serviços Mais Realizados\n\n${nomePeriodo.toUpperCase()}:\n\n`; 
    ordenados.slice(0, 5).forEach(([servico, qtd], i) => { resposta += `${i + 1}. ${servico}\n   ${qtd}x realizado${qtd > 1 ? 's' : ''}\n\n`; }); 
    return resposta; 
} 
 
async function gerarRelatorioGeral(user, periodo) { 
    const dataInicio = calcularDataInicio(periodo); 
    const agendamentos = user.appointmentsAsPro?.filter(a => new Date(a.date) >= dataInicio) || []; 
    const concluidos = agendamentos.filter(a => a.status === 'COMPLETED').length; 
    const pendentes = agendamentos.filter(a => a.status === 'PENDING').length; 
    const cancelados = agendamentos.filter(a => a.status === 'CANCELED').length; 
    const receita = agendamentos.filter(a => a.status === 'COMPLETED').reduce((sum, a) => sum + (a.totalPrice || 0), 0); 
    const clientes = new Set(agendamentos.map(a => a.clientId)).size; 
    const nomePeriodo = getNomePeriodo(periodo); 
    return `📊 Relatório Geral\n\n${nomePeriodo.toUpperCase()}:\n\nAgendamentos:\n✅ ${concluidos} concluído${concluidos !== 1 ? 's' : ''}\n⏳ ${pendentes} pendente${pendentes !== 1 ? 's' : ''}\n❌ ${cancelados} cancelado${cancelados !== 1 ? 's' : ''}\n\nFinanceiro:\n💰 R$ ${receita.toFixed(2)}\n\nClientes:\n👥 ${clientes} único${clientes !== 1 ? 's' : ''}`; 
}