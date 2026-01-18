// backend/src/controllers/VerificationController.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendPushNotification } = require('../services/notificationService');

module.exports = {

  // ============================================================
  // 1. PROFISSIONAL ENVIA DOCS (SOLICITAÇÃO)
  // ============================================================
  async requestVerification(req, res) {
    const { userId, documentImg, selfieImg } = req.body;

    try {
      // Verifica se já tem pedido pendente para evitar duplicação
      const pending = await prisma.verificationRequest.findFirst({
        where: { userId, status: 'PENDING' }
      });

      if (pending) {
        return res.status(400).json({ error: 'Você já tem uma análise em andamento.' });
      }

      await prisma.verificationRequest.create({
        data: { userId, documentImg, selfieImg }
      });

      return res.json({ success: true, message: 'Documentos enviados para análise!' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao enviar documentos.' });
    }
  },

  // ============================================================
  // 2. ADMIN LISTA PENDENTES
  // ============================================================
  async listPending(req, res) {
    const { requesterId } = req.query;
    try {
      const admin = await prisma.user.findUnique({ where: { id: requesterId } });
      
      // Validação de segurança básica (apenas Owner/Admin)
      if (admin.email !== 'contato.markaiapp@gmail.com') {
          return res.status(403).json({ error: 'Acesso negado.' });
      }

      const requests = await prisma.verificationRequest.findMany({
        where: { status: 'PENDING' },
        include: { 
            user: { 
                select: { id: true, name: true, email: true, companyName: true, avatarUrl: true } 
            } 
        },
        orderBy: { createdAt: 'asc' }
      });

      return res.json(requests);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao listar solicitações.' });
    }
  },

  // ============================================================
  // 3. ADMIN RESOLVE (APROVA OU REJEITA)
  // ============================================================
  async resolveRequest(req, res) {
    const { id } = req.params; // ID da Solicitação (Request)
    const { requesterId, status, reason } = req.body; // status: 'APPROVED' ou 'REJECTED'

    try {
      const admin = await prisma.user.findUnique({ where: { id: requesterId } });
      if (admin.email !== 'contato.markaiapp@gmail.com') {
          return res.status(403).json({ error: 'Acesso negado.' });
      }

      const request = await prisma.verificationRequest.findUnique({ 
        where: { id },
        include: { user: true }
      });

      if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });

      // Atualiza o status do pedido na tabela VerificationRequest
      await prisma.verificationRequest.update({
        where: { id },
        data: { 
            status, 
            reason: status === 'REJECTED' ? reason : null,
            resolvedAt: new Date() 
        }
      });

      // LÓGICA DE APROVAÇÃO
      if (status === 'APPROVED') {
        // Atualiza o usuário para ter o Selo Azul (isVerified = true)
        await prisma.user.update({
          where: { id: request.userId },
          data: { 
              isVerified: true, 
              activeFeedback: 'Parabéns! Sua identidade foi confirmada e você ganhou o selo de Verificado.' 
          }
        });

        // Envia Push Notification
        if (request.user.pushToken) {
          await sendPushNotification(request.user.pushToken, 'Verificação Aprovada 🎉', 'Você agora possui o selo de verificado!');
        }
      } 
      // LÓGICA DE REJEIÇÃO
      else {
        // Envia aviso/feedback para o usuário saber que foi recusado
        await prisma.user.update({
          where: { id: request.userId },
          data: { activeWarning: `Verificação recusada: ${reason || 'Documentos ilegíveis'}. Tente novamente.` }
        });
        
        if (request.user.pushToken) {
          await sendPushNotification(request.user.pushToken, 'Verificação Recusada', 'Verifique o motivo no app.');
        }
      }

      return res.json({ success: true });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao resolver solicitação.' });
    }
  },

  // ============================================================
  // 4. VERIFICAR STATUS ATUAL (USADO PELO APP PARA BLOQUEAR TELA)
  // ============================================================
  async getStatus(req, res) {
    const { userId } = req.params;
    try {
      // Busca o último pedido feito pelo usuário
      const request = await prisma.verificationRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });
      
      // Retorna o status ou 'NONE' se nunca enviou nada
      return res.json({ 
        status: request ? request.status : 'NONE',
        reason: request?.reason
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar status.' });
    }
  }
};