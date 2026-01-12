const { PrismaClient } = require('@prisma/client');
const { gerarRespostaIA } = require('../services/ai.service');
const { sendPushNotification } = require('../services/notificationService');
const prisma = new PrismaClient();

module.exports = {
  // Salvar Mensagem e Notificar
  async sendMessage(req, res) {
    const { senderId, receiverId, content } = req.body;
    try { 
      const msg = await prisma.chatMessage.create({ 
        data: { senderId, receiverId, content } 
      }); 

      const sender = await prisma.user.findUnique({ where: { id: senderId } });
      const receiver = await prisma.user.findUnique({ where: { id: receiverId } });

      if (receiver && receiver.pushToken) {
        await sendPushNotification(
          receiver.pushToken,
          `Mensagem de ${sender.companyName || sender.name}`,
          content,
          { screen: 'Chat', senderId: senderId, senderName: sender.companyName || sender.name }
        );
      }

      return res.json(msg); 
    } catch (e) { 
      return res.status(500).json({ error: 'Erro ao enviar mensagem' }); 
    }
  },

  // Listar Mensagens
  async listMessages(req, res) {
    const { userId, otherId } = req.params;
    try {
      const msgs = await prisma.chatMessage.findMany({
        where: { OR: [{ senderId: userId, receiverId: otherId }, { senderId: otherId, receiverId: userId }] },
        orderBy: { createdAt: 'asc' }
      });
      return res.json(msgs);
    } catch (e) { 
      return res.status(500).json({ error: 'Erro ao listar mensagens' }); 
    }
  },

  // Chat IA
  async aiChat(req, res) {
    const { message, userId } = req.body;
    try {
      const user = await prisma.user.findUnique({ 
        where: { id: userId }, 
        include: { appointmentsAsClient: { include: { professional: true } } } 
      });
      
      const responseText = await gerarRespostaIA(message, {
          nomeUsuario: user ? user.name : 'Usuário',
          agendamentos: user ? user.appointmentsAsClient : []
      });
      
      if (responseText.includes('[ENCERRAR]')) { 
        return res.json({ response: "Entendi. Se precisar agendar algo, estou por aqui! 👋" }); 
      }
      return res.json({ response: responseText });
    } catch (error) { 
      return res.status(500).json({ error: 'Erro na IA' }); 
    }
  }
};