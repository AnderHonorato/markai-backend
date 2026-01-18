// backend/src/controllers/ChatController.js
const { PrismaClient } = require('@prisma/client');
const { gerarRespostaIA } = require('../services/ai.service');
const { sendPushNotification } = require('../services/notificationService');
const prisma = new PrismaClient();

module.exports = {
  // 1. Salvar Mensagem e Notificar
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

  // 2. Listar Mensagens entre dois usuários
  async listMessages(req, res) {
    const { userId, otherId } = req.params;
    try {
      const msgs = await prisma.chatMessage.findMany({
        where: { 
            OR: [
                { senderId: userId, receiverId: otherId }, 
                { senderId: otherId, receiverId: userId }
            ] 
        },
        orderBy: { createdAt: 'asc' }
      });
      return res.json(msgs);
    } catch (e) { 
      return res.status(500).json({ error: 'Erro ao listar mensagens' }); 
    }
  },

  // 3. NOVO: Listar Conversas Ativas (Essencial para o Broadcast aparecer)
  async listConversations(req, res) {
    const { userId } = req.params;
    try {
      // Busca todas as mensagens onde o usuário está envolvido
      const messages = await prisma.chatMessage.findMany({
        where: { 
          OR: [{ senderId: userId }, { receiverId: userId }] 
        },
        include: { 
          sender: { select: { id: true, name: true, companyName: true, avatarUrl: true, type: true } }, 
          receiver: { select: { id: true, name: true, companyName: true, avatarUrl: true, type: true } } 
        },
        orderBy: { createdAt: 'desc' }
      });

      // Lógica para agrupar mensagens e criar lista de contatos únicos
      const contacts = [];
      const map = new Map();

      for (const m of messages) {
        const otherPerson = m.senderId === userId ? m.receiver : m.sender;
        
        if (!map.has(otherPerson.id)) {
          map.set(otherPerson.id, true);
          contacts.push({
            id: otherPerson.id,
            name: otherPerson.companyName || otherPerson.name,
            avatarUrl: otherPerson.avatarUrl,
            lastMessage: m.content,
            lastDate: m.createdAt,
            type: otherPerson.type === 'PROFESSIONAL' ? 'Profissional' : 'Cliente'
          });
        }
      }

      return res.json(contacts);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Erro ao listar conversas' });
    }
  },

  // 4. Chat IA
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