const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendPushNotification } = require('../services/notificationService');
const { enviarMensagem } = require('../bot'); 

module.exports = {
  // 1. Criar Agendamento
  async create(req, res) {
    const { clientId, proId, date, serviceList, totalPrice } = req.body;
    try {
      const pro = await prisma.user.findUnique({ where: { id: proId } });
      const client = await prisma.user.findUnique({ where: { id: clientId } });
      
      const duration = pro.serviceDuration || 60;
      const newStart = new Date(date);
      const newEnd = new Date(newStart.getTime() + duration * 60000); 

      // 1. Evita duplicidade exata (Anti-Spam)
      const exactDuplicate = await prisma.appointment.findFirst({
          where: { 
            clientId, 
            proId, 
            date: newStart, 
            status: { notIn: ['CANCELED', 'CANCELLED', 'NO_SHOW'] } 
          }
      });
      if (exactDuplicate) return res.status(400).json({ error: 'Você já tem um agendamento neste horário.' });

      // 2. Verifica conflito de horário
      const conflicts = await prisma.appointment.findMany({
          where: { 
            proId, 
            status: { notIn: ['CANCELED', 'NO_SHOW', 'CANCELLED'] },
            date: { gte: new Date(newStart.getTime() - duration * 60000), lte: newEnd } 
          }
      });

      if (conflicts.some(appt => {
          const s = new Date(appt.date); 
          const e = new Date(s.getTime() + duration * 60000);
          return (newStart < e && newEnd > s);
      })) return res.status(400).json({ error: 'Horário indisponível.' });

      // 3. Cria o agendamento
      const appointment = await prisma.appointment.create({ 
        data: { 
          clientId, 
          proId, 
          date: newStart, 
          status: 'PENDING',
          serviceList: serviceList || 'Serviço', 
          totalPrice: parseFloat(totalPrice) || 0,
          clientConfirmed: true, 
          proConfirmed: false
        } 
      });

      if (pro.pushToken) {
        await sendPushNotification(pro.pushToken, "Novo Agendamento! 📅", `${client.name} solicitou: ${serviceList}`);
      }

      return res.json(appointment);
    } catch (error) { 
      console.log(error);
      return res.status(500).json({ error: 'Erro ao agendar' }); 
    }
  },

  // 2. Listar Agendamentos
  async list(req, res) {
    const { userId, type } = req.query;
    const where = type === 'PROFESSIONAL' ? { proId: userId } : { clientId: userId };
    try {
      let appointments = await prisma.appointment.findMany({ 
        where, 
        include: { 
            client: true, 
            professional: true, 
            reviews: true // <--- IMPORTANTE: Plural (reviews) para suportar múltiplas avaliações
        }, 
        orderBy: { date: 'asc' } 
      });

      // Atualiza status antigos para 'Aguardando Feedback' se já passaram
      const now = new Date();
      for (let app of appointments) {
        const appDate = new Date(app.date);
        const duration = app.professional?.serviceDuration || 60;
        
        if (now > new Date(appDate.getTime() + duration * 60000) && app.status === 'CONFIRMED') {
           await prisma.appointment.update({ where: { id: app.id }, data: { status: 'AWAITING_FEEDBACK' } });
           app.status = 'AWAITING_FEEDBACK';
        }
      }
      return res.json(appointments);
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar' }); }
  },

  // 3. Confirmar Agendamento
  async confirm(req, res) {
    const { id } = req.params;
    try {
      const appt = await prisma.appointment.update({
        where: { id },
        data: { status: 'CONFIRMED', proConfirmed: true },
        include: { client: true, professional: true }
      });

      // Tenta enviar WhatsApp
      try {
        const dataFormatada = new Date(appt.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        await enviarMensagem(appt.client.phone, `✅ *Confirmado!*\nOlá ${appt.client.name}, seu horário na *${appt.professional.companyName || appt.professional.name}* às *${dataFormatada}* foi aceito.`);
      } catch (e) {}

      // Tenta enviar Push
      if (appt.client.pushToken) {
          await sendPushNotification(appt.client.pushToken, "Confirmado! ✅", "O profissional aceitou seu agendamento.");
      }

      return res.json(appt);
    } catch (error) { return res.status(500).json({ error: 'Erro ao confirmar' }); }
  },

  // 4. Propor Novo Horário (Reagendamento)
  async propose(req, res) {
    const { id } = req.params;
    const { newDate, reason, byWho } = req.body;
    try {
      const appt = await prisma.appointment.update({
        where: { id },
        data: {
          status: 'RESCHEDULE_REQ',
          rescheduleDate: new Date(newDate),
          rescheduleReason: reason,
          rescheduleBy: byWho 
        },
        include: { client: true, professional: true }
      });

      const target = byWho === 'PRO' ? appt.client : appt.professional;
      if (target.pushToken) {
        await sendPushNotification(target.pushToken, "Nova Proposta 📅", "Sugestão de novo horário recebida.");
      }

      return res.json(appt);
    } catch (error) { return res.status(500).json({ error: 'Erro ao propor horário' }); }
  },

  // 5. Responder Proposta
  async respond(req, res) {
    const { id } = req.params;
    const { accept } = req.body;
    try {
      const current = await prisma.appointment.findUnique({ where: { id } });
      
      let data = {};
      if (accept) {
        data = {
          date: current.rescheduleDate,
          status: 'CONFIRMED',
          rescheduleDate: null, rescheduleBy: null, rescheduleReason: null
        };
      } else {
        data = {
          status: 'CONFIRMED', 
          rescheduleDate: null, rescheduleBy: null, rescheduleReason: null
        };
      }

      const appt = await prisma.appointment.update({
        where: { id },
        data,
        include: { client: true, professional: true }
      });

      const proposer = current.rescheduleBy === 'PRO' ? appt.professional : appt.client;
      if (proposer.pushToken) {
         const txt = accept ? "Proposta Aceita! ✅" : "Proposta Recusada ❌";
         await sendPushNotification(proposer.pushToken, txt, "A outra parte respondeu sua sugestão.");
      }

      return res.json(appt);
    } catch (error) { return res.status(500).json({ error: 'Erro ao responder' }); }
  },

  // 6. Finalizar Manualmente
  async finish(req, res) {
    const { id } = req.params;
    const { attended, isEarly } = req.body; // Recebe flag de antecipado
    try {
      const status = attended ? 'COMPLETED' : 'NO_SHOW';
      
      const appointment = await prisma.appointment.update({ 
          where: { id }, 
          data: { 
              status,
              isFinishedEarly: isEarly || false 
          }, 
          include: { client: true } 
      });

      if (attended) {
          await prisma.user.update({ where: { id: appointment.clientId }, data: { totalAppointments: { increment: 1 } } });
          
          // Notificação diferenciada
          if (appointment.client.pushToken) {
              const title = isEarly ? "Atendido Antecipadamente ✅" : "Serviço Concluído ✅";
              const body = isEarly ? "Seu atendimento foi finalizado antes do horário previsto." : "Obrigado pela preferência!";
              await sendPushNotification(appointment.client.pushToken, title, body);
          }
      } else {
          await prisma.user.update({ where: { id: appointment.clientId }, data: { noShowCount: { increment: 1 } } });
      }

      return res.json(appointment);
    } catch (error) { return res.status(500).json({ error: 'Erro ao finalizar' }); }
  },

  // 7. Cancelar Agendamento
  async cancel(req, res) {
    const { id } = req.params;
    const { reason, byWho } = req.body;
    try {
      const appt = await prisma.appointment.update({
        where: { id },
        data: { 
            status: 'CANCELED', 
            cancelReason: reason, 
            cancelledBy: byWho, 
            rescheduleDate: null 
        },
        include: { client: true, professional: true }
      });

      const target = byWho === 'PRO' ? appt.client : appt.professional;
      if (target.pushToken) {
          await sendPushNotification(target.pushToken, "Cancelado ❌", "O agendamento foi cancelado.");
      }

      return res.json(appt);
    } catch (error) { return res.status(500).json({ error: 'Erro cancelar' }); }
  },

  // 8. Atualizar Status Genérico
  async updateStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body;
    try {
      const appt = await prisma.appointment.update({ 
        where: { id }, data: { status }, include: { client: true, professional: true }
      });
      return res.json(appt);
    } catch (error) { return res.status(500).json({ error: 'Erro status' }); }
  },

  // 9. Check-in por QR Code
  async qrCheckIn(req, res) {
    const { clientId, proId } = req.body;
    try {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
      
      const appointment = await prisma.appointment.findFirst({
        where: { clientId, proId, status: 'CONFIRMED', date: { gte: startOfDay, lte: endOfDay } },
        include: { client: true, professional: true }
      });
      
      if (!appointment) return res.status(404).json({ error: 'Nenhum agendamento confirmado para hoje.' });
      
      await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'COMPLETED' } });
      await prisma.user.update({ where: { id: clientId }, data: { totalAppointments: { increment: 1 } } });
      
      return res.json({ success: true });
    } catch (error) { return res.status(500).json({ error: 'Erro no check-in' }); }
  }
};