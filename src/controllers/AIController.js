const { gerarRespostaIA } = require('../services/ai.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = {
    async chat(req, res) {
        const { message, userId } = req.body;
        console.log(`📥 Mensagem: ${message}`);

        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: { appointmentsAsClient: { where: { status: { in: ['PENDING', 'CONFIRMED'] } }, include: { professional: true } } }
            });

            // Busca por profissionais baseada no texto da mensagem
            const profissionaisFiltrados = await prisma.user.findMany({
                where: {
                    type: 'PROFESSIONAL',
                    OR: [
                        { companyName: { contains: message.replace('Quero agendar com ', ''), mode: 'insensitive' } },
                        { name: { contains: message.replace('Quero agendar com ', ''), mode: 'insensitive' } }
                    ]
                },
                select: { id: true, companyName: true, name: true },
                take: 3
            });

            const lastMessages = await prisma.chatMessage.findMany({
                where: { OR: [{ senderId: userId }, { receiverId: userId }] },
                orderBy: { createdAt: 'desc' },
                take: 10
            });

            const historicoFormatado = lastMessages.reverse().map(m => ({
                text: m.content,
                fromMe: m.senderId !== userId
            }));

            const resposta = await gerarRespostaIA(message, {
                nomeUsuario: user?.name || 'Anderson',
                tipoUsuario: user?.type || 'CLIENT',
                isVerified: user?.isVerified || false,
                agendamentos: user?.appointmentsAsClient || [],
                profissionaisEncontrados: profissionaisFiltrados // Injeta os dados reais para a IA confirmar
            }, historicoFormatado);

            return res.json({ response: resposta });
        } catch (error) {
            console.error("❌ Erro no AIController:", error.message);
            return res.status(500).json({ error: 'Erro no servidor.' });
        }
    }
};