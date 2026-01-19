// backend/src/controllers/AIController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * ✅ IA DO APP - Sistema de Suporte e Busca
 * Diferente do bot WhatsApp que é vinculado a um profissional
 */

// Estados das conversas (em memória)
const chatStates = {};

module.exports = {
    async chat(req, res) {
        try {
            const { userId, message } = req.body;
            
            console.log('[AIController - App] Nova mensagem');
            console.log('[AIController - App] UserId:', userId);
            console.log('[AIController - App] Mensagem:', message);

            if (!userId || !message) {
                return res.status(400).json({ 
                    error: 'userId e message são obrigatórios' 
                });
            }

            // Busca usuário
            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: {
                    appointmentsAsClient: {
                        where: {
                            date: { gte: new Date() },
                            status: { notIn: ['CANCELED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] }
                        },
                        include: {
                            professional: true
                        },
                        orderBy: { date: 'asc' }
                    },
                    appointmentsAsPro: {
                        where: {
                            date: { gte: new Date() },
                            status: { notIn: ['CANCELED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] }
                        },
                        include: {
                            client: true
                        },
                        orderBy: { date: 'asc' }
                    }
                }
            });

            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            // ✅ IDENTIFICA TIPO DE USUÁRIO
            const isProfessional = user.type === 'PROFESSIONAL';
            const isClient = user.type === 'CLIENT';

            console.log('[AIController - App] Tipo:', user.type);
            console.log('[AIController - App] É profissional?', isProfessional);

            // ============================================
            // TRATAMENTO PARA PROFISSIONAIS
            // ============================================
            if (isProfessional) {
                const response = await handleProfessionalChat(user, message);
                return res.json({ response });
            }

            // ============================================
            // TRATAMENTO PARA CLIENTES
            // ============================================
            if (isClient) {
                const response = await handleClientChat(user, message, userId);
                return res.json({ response });
            }

            // Tipo desconhecido
            return res.json({ 
                response: "Olá! 👋 Sou a Markaí.\n\nParece que seu cadastro está incompleto.\n\nPor favor, atualize suas informações no perfil." 
            });

        } catch (error) {
            console.error('[AIController - App] Erro:', error.message);
            console.error(error.stack);
            return res.status(500).json({ 
                error: 'Erro ao processar mensagem',
                details: error.message 
            });
        }
    }
};

/**
 * ✅ CHAT PARA PROFISSIONAIS - Suporte e Estatísticas
 */
async function handleProfessionalChat(user, message) {
    const msgLower = message.toLowerCase().trim();
    
    // Conta agendamentos ativos
    const agendamentosAtivos = user.appointmentsAsPro?.length || 0;
    const proximoAgendamento = user.appointmentsAsPro?.[0];
    
    // Detecta intenções
    if (msgLower.includes('agendamento') || msgLower.includes('agenda')) {
        if (agendamentosAtivos === 0) {
            return `📅 *Sua Agenda*\n\nVocê não tem agendamentos ativos no momento.\n\nOs clientes podem agendar pelo seu perfil ou pelo WhatsApp Bot!`;
        }
        
        let resposta = `📅 *Sua Agenda*\n\n✅ *${agendamentosAtivos} agendamento${agendamentosAtivos > 1 ? 's' : ''} ativo${agendamentosAtivos > 1 ? 's' : ''}*\n\n`;
        
        if (proximoAgendamento) {
            const data = new Date(proximoAgendamento.date);
            const dataFormatada = data.toLocaleDateString('pt-BR');
            const horaFormatada = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            resposta += `🔜 *Próximo:*\n• ${proximoAgendamento.client.name}\n• ${dataFormatada} às ${horaFormatada}\n• ${proximoAgendamento.serviceList}`;
        }
        
        return resposta;
    }
    
    if (msgLower.includes('bot') || msgLower.includes('whatsapp')) {
        return `🤖 *WhatsApp Bot*\n\nSeu assistente virtual responde automaticamente seus clientes!\n\n✅ Para ativar:\n1. Vá em *Configurações*\n2. Clique em *Bot WhatsApp*\n3. Conecte seu número\n\nO bot agenda, confirma horários e responde dúvidas 24h!`;
    }
    
    if (msgLower.includes('serviço') || msgLower.includes('servico')) {
        const totalServicos = user.services?.length || 0;
        return `📋 *Seus Serviços*\n\nVocê tem *${totalServicos} serviço${totalServicos !== 1 ? 's' : ''}* cadastrado${totalServicos !== 1 ? 's' : ''}.\n\nPara adicionar ou editar:\n*Perfil → Serviços*`;
    }
    
    // Resposta padrão para profissionais
    return `👋 Olá, *${user.name || user.companyName}*!\n\n📊 *Status Rápido:*\n• ${agendamentosAtivos} agendamento${agendamentosAtivos !== 1 ? 's' : ''} ativo${agendamentosAtivos !== 1 ? 's' : ''}\n\n💡 *Posso ajudar com:*\n• Ver sua agenda\n• Configurar WhatsApp Bot\n• Gerenciar serviços\n\nO que precisa?`;
}

/**
 * ✅ CHAT PARA CLIENTES - Busca de Profissionais
 */
async function handleClientChat(user, message, userId) {
    const msgLower = message.toLowerCase().trim();
    
    // Inicializa estado se não existir
    if (!chatStates[userId]) {
        chatStates[userId] = {
            etapa: 'INICIO',
            categoria: null,
            localizacao: null,
            profissionaisFiltrados: []
        };
    }
    
    const estado = chatStates[userId];
    
    // ============================================
    // FLUXO DE BUSCA DE PROFISSIONAIS
    // ============================================
    
    // ETAPA: INICIO - Apresentação
    if (estado.etapa === 'INICIO') {
        // Verifica agendamentos ativos do cliente
        const agendamentosAtivos = user.appointmentsAsClient?.length || 0;
        
        // Detecta intenção de agendar
        if (msgLower.includes('agendar') || msgLower.includes('marcar')) {
            estado.etapa = 'ESCOLHENDO_CATEGORIA';
            
            // Busca categorias disponíveis
            const categorias = await prisma.user.findMany({
                where: { 
                    type: 'PROFESSIONAL',
                    isAccountActive: true 
                },
                select: { mainCategory: true },
                distinct: ['mainCategory']
            });
            
            let resposta = `🔍 *Vamos encontrar o profissional ideal!*\n\n📋 *Escolha a categoria:*\n\n`;
            
            categorias.forEach((cat, i) => {
                resposta += `*${i + 1}.* ${cat.mainCategory}\n`;
            });
            
            resposta += `\n_Digite o número da categoria_`;
            
            // Salva categorias no estado
            estado.categoriasDisponiveis = categorias.map(c => c.mainCategory);
            
            return resposta;
        }
        
        // Ver agendamentos
        if (msgLower.includes('agendamento') || msgLower.includes('agenda')) {
            if (agendamentosAtivos === 0) {
                return `📅 *Seus Agendamentos*\n\nVocê não tem agendamentos ativos.\n\nQue tal agendar um serviço?\nDigite *"agendar"* para começar!`;
            }
            
            let resposta = `📅 *Seus Agendamentos*\n\n✅ ${agendamentosAtivos} agendamento${agendamentosAtivos > 1 ? 's' : ''} ativo${agendamentosAtivos > 1 ? 's' : ''}:\n\n`;
            
            user.appointmentsAsClient.slice(0, 3).forEach((appt, i) => {
                const data = new Date(appt.date);
                const dataFormatada = data.toLocaleDateString('pt-BR');
                const horaFormatada = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                
                resposta += `${i + 1}. *${appt.professional.companyName || appt.professional.name}*\n`;
                resposta += `   ${dataFormatada} às ${horaFormatada}\n`;
                resposta += `   ${appt.serviceList}\n\n`;
            });
            
            return resposta;
        }
        
        // Resposta padrão
        return `👋 Olá, *${user.name}*!\n\n📊 Você tem *${agendamentosAtivos} agendamento${agendamentosAtivos !== 1 ? 's' : ''} ativo${agendamentosAtivos !== 1 ? 's' : ''}*\n\n💡 *Posso ajudar com:*\n• Agendar serviços\n• Ver seus agendamentos\n• Encontrar profissionais\n\nO que precisa?`;
    }
    
    // ETAPA: ESCOLHENDO CATEGORIA
    if (estado.etapa === 'ESCOLHENDO_CATEGORIA') {
        const escolha = parseInt(message);
        
        if (isNaN(escolha) || escolha < 1 || escolha > estado.categoriasDisponiveis.length) {
            return `❌ *Número inválido*\n\nEscolha de 1 a ${estado.categoriasDisponiveis.length}`;
        }
        
        estado.categoria = estado.categoriasDisponiveis[escolha - 1];
        estado.etapa = 'COLETANDO_LOCALIZACAO';
        
        return `✅ *${estado.categoria}*\n\n📍 *Para encontrar os mais próximos de você:*\n\nDigite seu CEP ou cidade\n\n_Exemplo: 40000-000 ou Salvador_`;
    }
    
    // ETAPA: COLETANDO LOCALIZAÇÃO
    if (estado.etapa === 'COLETANDO_LOCALIZACAO') {
        estado.localizacao = message.trim();
        
        // Busca profissionais da categoria
        const profissionais = await prisma.user.findMany({
            where: {
                type: 'PROFESSIONAL',
                mainCategory: estado.categoria,
                isAccountActive: true
            },
            include: {
                services: true,
                appointmentsAsPro: {
                    where: { status: 'COMPLETED' }
                }
            },
            take: 10
        });
        
        if (profissionais.length === 0) {
            delete chatStates[userId];
            return `😔 *Nenhum profissional encontrado*\n\nNão encontramos profissionais de *${estado.categoria}* ainda.\n\nTente outra categoria!\nDigite *"agendar"* para buscar novamente.`;
        }
        
        estado.profissionaisFiltrados = profissionais;
        estado.etapa = 'ESCOLHENDO_PROFISSIONAL';
        
        let resposta = `🎯 *Encontramos ${profissionais.length} profissional${profissionais.length > 1 ? 'is' : ''}!*\n\n`;
        
        profissionais.slice(0, 5).forEach((pro, i) => {
            const avaliacoes = pro.totalReviews || 0;
            const nota = pro.reputationScore?.toFixed(1) || '5.0';
            const cidade = pro.city || 'Não informado';
            
            resposta += `*${i + 1}. ${pro.companyName || pro.name}*\n`;
            resposta += `   📍 ${cidade}\n`;
            resposta += `   ⭐ ${nota} (${avaliacoes} avaliações)\n`;
            resposta += `   💼 ${pro.services?.length || 0} serviços\n\n`;
        });
        
        resposta += `_Digite o número do profissional_`;
        
        return resposta;
    }
    
    // ETAPA: ESCOLHENDO PROFISSIONAL
    if (estado.etapa === 'ESCOLHENDO_PROFISSIONAL') {
        const escolha = parseInt(message);
        
        if (isNaN(escolha) || escolha < 1 || escolha > estado.profissionaisFiltrados.length) {
            return `❌ *Número inválido*\n\nEscolha de 1 a ${estado.profissionaisFiltrados.length}`;
        }
        
        const profissional = estado.profissionaisFiltrados[escolha - 1];
        
        delete chatStates[userId]; // Limpa estado
        
        // Retorna informações para navegação
        return JSON.stringify({
            intent: "SELECT_PROFESSIONAL",
            message: `✅ *${profissional.companyName || profissional.name}*\n\nVocê pode ver o perfil completo e agendar!`,
            proId: profissional.id,
            proName: profissional.companyName || profissional.name
        });
    }
    
    return `Não entendi 😕\n\nDigite *"agendar"* para buscar profissionais!`;
}