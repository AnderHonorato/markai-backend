// backend/src/controllers/AppointmentController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendPushNotification } = require('../services/notificationService');
const { enviarMensagem } = require('../bot'); 
const { addMinutes, parseISO, isBefore, format } = require('date-fns');
const { calcularHorariosLivres } = require('../utils/date.util');

// --- NOVA FORMATAÇÃO DE ID (MARKAI-00000-00001) ---
const formatDisplayId = (seqId) => {
    return `MARKAI-${String(seqId).padStart(10, '0').replace(/(\d{5})(\d{5})/, '$1-$2')}`;
};

module.exports = {
  // 1. Criar Agendamento
  async create(req, res) {
    const { clientId, proId, date, serviceList, totalPrice } = req.body;

    const appointmentDate = parseISO(date);
    if (isBefore(appointmentDate, new Date())) {
        return res.status(400).json({ error: 'Não é possível agendar em datas passadas.' });
    }

    try {
      const pro = await prisma.user.findUnique({ where: { id: proId } });
      const client = await prisma.user.findUnique({ where: { id: clientId } });
      
      if (!pro || !client) return res.status(404).json({ error: 'Usuário não encontrado' });

      const duration = pro.serviceDuration || 60;
      const endDate = addMinutes(appointmentDate, duration);

      const conflicts = await prisma.appointment.findMany({
          where: { 
            proId, 
            status: { notIn: ['CANCELED', 'CANCELLED', 'NO_SHOW', 'COMPLETED'] }
          }
      });

      const hasConflict = conflicts.some(appt => {
          const s = new Date(appt.date); 
          const e = addMinutes(s, duration);
          return (appointmentDate < e && endDate > s);
      });

      if (hasConflict) {
          return res.status(400).json({ error: 'Este horário já está ocupado.' });
      }

      const appointment = await prisma.appointment.create({ 
        data: { 
          clientId, 
          proId, 
          date: appointmentDate, 
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

      const result = {
          ...appointment,
          displayId: formatDisplayId(appointment.seqId)
      };

      return res.json(result);
    } catch (error) { 
      console.log(error);
      return res.status(500).json({ error: 'Erro ao agendar' }); 
    }
  },

  // 2. Listar Agendamentos
  async list(req, res) {
    const { userId, type, search } = req.query; 
    
    try {
      let where = {};
      if (type === 'PROFESSIONAL') {
        where.proId = userId;
      } else {
        where.clientId = userId;
      }

      if (search) {
          const cleanSearch = search.replace(/\D/g, ''); 
          if (cleanSearch.length > 0) {
             const seqId = parseInt(cleanSearch);
             where.OR = [
                 { seqId: seqId },
                 type === 'PROFESSIONAL' 
                   ? { client: { name: { contains: search, mode: 'insensitive' } } }
                   : { professional: { companyName: { contains: search, mode: 'insensitive' } } }
             ];
          } else {
             if (type === 'PROFESSIONAL') {
                 where.client = { name: { contains: search, mode: 'insensitive' } };
             } else {
                 where.professional = { companyName: { contains: search, mode: 'insensitive' } };
             }
          }
      }

      let appointments = await prisma.appointment.findMany({ 
        where, 
        include: { 
            client: true, 
            professional: true, 
            reviews: true 
        }, 
        orderBy: { date: 'desc' }
      });

      const now = new Date();
      for (let app of appointments) {
        const appDate = new Date(app.date);
        const duration = app.professional?.serviceDuration || 60;
        
        if (now > addMinutes(appDate, duration) && app.status === 'CONFIRMED') {
           await prisma.appointment.update({ where: { id: app.id }, data: { status: 'AWAITING_FEEDBACK' } });
           app.status = 'AWAITING_FEEDBACK';
        }
      }

      const formattedApps = appointments.map(app => ({
          ...app,
          displayId: formatDisplayId(app.seqId)
      }));

      return res.json(formattedApps);
    } catch (error) { 
        console.log(error);
        return res.status(500).json({ error: 'Erro ao buscar' }); 
    }
  },

  // 3. Confirmar
  async confirm(req, res) {
    const { id } = req.params;
    try {
      const appt = await prisma.appointment.update({
        where: { id },
        data: { status: 'CONFIRMED', proConfirmed: true },
        include: { client: true, professional: true }
      });

      try {
        const dataFormatada = format(new Date(appt.date), "HH:mm");
        await enviarMensagem(appt.client.phone, `✅ *Confirmado!*\nOlá ${appt.client.name}, seu horário na *${appt.professional.companyName || appt.professional.name}* às *${dataFormatada}* foi aceito.`);
      } catch (e) { console.log("Erro ao enviar whats:", e); }

      if (appt.client.pushToken) {
          await sendPushNotification(appt.client.pushToken, "Confirmado! ✅", "O profissional aceitou seu agendamento.");
      }

      return res.json(appt);
    } catch (error) { return res.status(500).json({ error: 'Erro ao confirmar' }); }
  },

  // 4. Propor Novo Horário
  async propose(req, res) {
    const { id } = req.params;
    const { newDate, reason, byWho } = req.body;
    
    const dateObj = parseISO(newDate);
    if (isBefore(dateObj, new Date())) {
        return res.status(400).json({ error: 'Não é possível reagendar para o passado.' });
    }

    try {
      const currentAppt = await prisma.appointment.findUnique({ where: { id } });
      const pro = await prisma.user.findUnique({ where: { id: currentAppt.proId } });
      
      const duration = pro.serviceDuration || 60;
      const endDate = addMinutes(dateObj, duration);

      const allApps = await prisma.appointment.findMany({
          where: {
              proId: currentAppt.proId,
              id: { not: id },
              status: { notIn: ['CANCELED', 'CANCELLED', 'NO_SHOW', 'COMPLETED'] }
          }
      });

      const hasConflict = allApps.some(appt => {
          const start = new Date(appt.date);
          const end = addMinutes(start, duration);
          return (dateObj < end && endDate > start);
      });

      if (hasConflict) {
          return res.status(400).json({ error: 'Horário indisponível para troca.' });
      }

      const appt = await prisma.appointment.update({
        where: { id },
        data: {
          status: 'RESCHEDULE_REQ',
          rescheduleDate: dateObj,
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

  // 5. Responder Proposta (COM REGISTRO DE HISTÓRICO)
  async respond(req, res) {
    const { id } = req.params;
    const { accept } = req.body;
    try {
      const current = await prisma.appointment.findUnique({ where: { id } });
      
      // Cria a mensagem de histórico para salvar no banco
      const historyLog = accept ? "Negociação Aceita" : "Negociação Recusada";

      let data = {};
      if (accept) {
        data = {
          date: current.rescheduleDate, // Atualiza a data oficial
          status: 'CONFIRMED',
          rescheduleDate: null, 
          rescheduleBy: null,
          rescheduleReason: historyLog // Salva o histórico aqui em vez de null
        };
      } else {
        data = {
          status: 'CONFIRMED', 
          rescheduleDate: null, 
          rescheduleBy: null,
          rescheduleReason: historyLog // Salva o histórico
        };
      }

      const appt = await prisma.appointment.update({
        where: { id },
        data,
        include: { client: true, professional: true }
      });

      const proposer = current.rescheduleBy === 'PRO' ? appt.professional : appt.client;
      if (proposer && proposer.pushToken) {
         const txt = accept ? "Proposta Aceita! ✅" : "Proposta Recusada ❌";
         await sendPushNotification(proposer.pushToken, txt, "A outra parte respondeu sua sugestão.");
      }

      return res.json(appt);
    } catch (error) { return res.status(500).json({ error: 'Erro ao responder' }); }
  },

  // 6. Finalizar
  async finish(req, res) {
    const { id } = req.params;
    const { attended, isEarly } = req.body; 
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

  // 7. Cancelar
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

  // 8. Atualizar Status
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

  // 9. Check-in
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
  },

  // 10. Obter Horários Disponíveis
  async getAvailableSlots(req, res) {
    const { proId } = req.params;
    const { date } = req.query; // Espera uma string de data (ex: 2026-01-20)

    if (!proId || !date) {
      return res.status(400).json({ error: 'ID do profissional e data são obrigatórios.' });
    }

    try {
      const selectedDate = parseISO(date);
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);

      // Busca dados do profissional para obter horários de trabalho e duração padrão
      const pro = await prisma.user.findUnique({ where: { id: proId } });
      if (!pro) return res.status(404).json({ error: 'Profissional não encontrado.' });

      // Busca agendamentos ativos para o dia selecionado
      const appointments = await prisma.appointment.findMany({
        where: {
          proId,
          date: { gte: start, lte: end },
          status: { notIn: ['CANCELED', 'CANCELLED', 'NO_SHOW'] }
        }
      });

      // Calcula os slots livres usando a lógica centralizada no utilitário
      const availableSlots = calcularHorariosLivres(selectedDate, appointments, pro);

      return res.json(availableSlots);
    } catch (error) {
      console.error("❌ Erro ao buscar slots:", error);
      return res.status(500).json({ error: 'Erro ao calcular horários disponíveis.' });
    }
  }
};