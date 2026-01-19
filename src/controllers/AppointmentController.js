// backend/src/controllers/AppointmentController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendPushNotification } = require('../services/notificationService');
const MultiSessionBot = require('../services/MultiSessionBot');
const { addMinutes, parseISO, isBefore, format } = require('date-fns');
const { calcularHorariosLivres } = require('../utils/date.util');



// --- NOVA FORMATAÇÃO DE ID (MARKAI-00000-00001) ---
const formatDisplayId = (seqId) => {
    return `MARKAI-${String(seqId).padStart(10, '0').replace(/(\d{5})(\d{5})/, '$1-$2')}`;
};

/**
 * ✅ ENVIA MENSAGEM WHATSAPP VIA BOT
 */
async function enviarWhatsApp(professionalId, phoneNumber, mensagem) {
    try {
        console.log('\n📤 ENVIANDO WHATSAPP');

        const sock = MultiSessionBot.getSocket(professionalId);

        if (!sock) {
            console.log('❌ Bot NÃO conectado para o profissional:', professionalId);
            return false;
        }

        if (!phoneNumber) {
            console.log('❌ Telefone do cliente inválido');
            return false;
        }

        // 🔥 NORMALIZA TELEFONE CORRETAMENTE
        let numero = phoneNumber.replace(/\D/g, '');

        // Garante código do Brasil
        if (!numero.startsWith('55')) {
            numero = '55' + numero;
          }

        const [check] = await sock.onWhatsApp(numero);

        if (!check || !check.exists) {
            console.log('❌ Número NÃO possui WhatsApp:', numero);
            return false;
        }

        const jid = check.jid;

        const textoLimpo = mensagem
          .replace(/\r/g, '')
          .replace(/\n\s+/g, '\n')
          .trim();

        console.log('📞 JID validado:', jid);
        console.log('📝 TEXTO FINAL:', textoLimpo);

        await sock.sendMessage(jid, { text: textoLimpo });



        console.log('✅ WhatsApp enviado com sucesso');
        return true;

    } catch (error) {
        console.error('❌ Erro ao enviar WhatsApp:', error);
        return false;
    }
}


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

  // 3. Confirmar ✅ CORRIGIDO
  async confirm(req, res) {
    const { id } = req.params;

    try {
      // 🔎 1. BUSCA O AGENDAMENTO (SEM CONFIRMAR)
      const appt = await prisma.appointment.findUnique({
        where: { id },
        include: { client: true, professional: true }
      });

      if (!appt) {
        return res.status(404).json({ error: 'Agendamento não encontrado' });
      }

      // ⚠️ 2. VERIFICA AGENDAMENTO DUPLICADO
      const existing = await prisma.appointment.findFirst({
        where: {
          clientId: appt.clientId,
          proId: appt.proId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          id: { not: id }
        }
      });

      if (existing) {
        const dataExistente = format(
          new Date(existing.date),
          "dd/MM/yyyy 'às' HH:mm"
        );

        const aviso = `⚠️ *ATENÇÃO*\n\nVocê já possui um agendamento ativo com este profissional:\n\n📅 ${dataExistente}\n📋 ${existing.serviceList}\n\nSe precisar alterar, cancele o anterior 😉`;

        await enviarWhatsApp(appt.proId, appt.client.phone, aviso);
      }

      // ✅ 3. AGORA CONFIRMA
      const confirmed = await prisma.appointment.update({
        where: { id },
        data: { status: 'CONFIRMED', proConfirmed: true },
        include: { client: true, professional: true }
      });


      // ✅ ENVIA WHATSAPP COM TELEFONE DO CLIENTE
      try {
        console.log('\n🔔 CONFIRMAÇÃO DE AGENDAMENTO');
        console.log('Cliente:', appt.client.name);
        console.log('Telefone do cliente:', appt.client.phone);
        
        const dataFormatada = format(new Date(appt.date), "dd/MM/yyyy 'às' HH:mm");
        const mensagem = `🎉 *CONFIRMADO!*\n\n✅ ${appt.professional.companyName || appt.professional.name} aceitou!\n\n📅 ${dataFormatada}\n📋 ${appt.serviceList}\n\nTe avisaremos quando estiver próximo! ⏰`;
        
        // Usa o telefone do CLIENTE (não do agendamento)
        await enviarWhatsApp(appt.proId, appt.client.phone, mensagem);
        
      } catch (e) { 
        console.log("❌ Erro ao enviar WhatsApp:", e.message); 
      }

      // Push notification
      if (appt.client.pushToken) {
          await sendPushNotification(appt.client.pushToken, "Confirmado! ✅", "O profissional aceitou seu agendamento.");
      }

      return res.json(appt);
    } catch (error) { 
      console.error('Erro ao confirmar:', error);
      return res.status(500).json({ error: 'Erro ao confirmar' }); 
    }
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
    } catch (error) { 
      console.error('Erro ao propor:', error);
      return res.status(500).json({ error: 'Erro ao propor horário' }); 
    }
  },

  // 5. Responder Proposta
  async respond(req, res) {
    const { id } = req.params;
    const { accept } = req.body;
    try {
      const current = await prisma.appointment.findUnique({ where: { id } });
      
      const historyLog = accept ? "Negociação Aceita" : "Negociação Recusada";

      let data = {};
      if (accept) {
        data = {
          date: current.rescheduleDate,
          status: 'CONFIRMED',
          rescheduleDate: null, 
          rescheduleBy: null,
          rescheduleReason: historyLog
        };
      } else {
        data = {
          status: 'CONFIRMED', 
          rescheduleDate: null, 
          rescheduleBy: null,
          rescheduleReason: historyLog
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
    } catch (error) { 
      console.error('Erro ao responder:', error);
      return res.status(500).json({ error: 'Erro ao responder' }); 
    }
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
          include: { client: true, professional: true }
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
    } catch (error) { 
      console.error('Erro ao finalizar:', error);
      return res.status(500).json({ error: 'Erro ao finalizar' }); 
    }
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
    } catch (error) { 
      console.error('Erro ao cancelar:', error);
      return res.status(500).json({ error: 'Erro cancelar' }); 
    }
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
    } catch (error) { 
      console.error('Erro ao atualizar status:', error);
      return res.status(500).json({ error: 'Erro status' }); 
    }
  },

  // 9. Check-in
  async qrCheckIn(req, res) {
    const { clientId, proId } = req.body;
    try {
      const startOfDay = new Date(); 
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(); 
      endOfDay.setHours(23, 59, 59, 999);
      
      const appointment = await prisma.appointment.findFirst({
        where: { clientId, proId, status: 'CONFIRMED', date: { gte: startOfDay, lte: endOfDay } },
        include: { client: true, professional: true }
      });
      
      if (!appointment) return res.status(404).json({ error: 'Nenhum agendamento confirmado para hoje.' });
      
      await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'COMPLETED' } });
      await prisma.user.update({ where: { id: clientId }, data: { totalAppointments: { increment: 1 } } });
      
      return res.json({ success: true });
    } catch (error) { 
      console.error('Erro no check-in:', error);
      return res.status(500).json({ error: 'Erro no check-in' }); 
    }
  },

  // 10. Obter Horários Disponíveis
  async getAvailableSlots(req, res) {
    const { proId } = req.params;
    const { date } = req.query;

    if (!proId || !date) {
      return res.status(400).json({ error: 'ID do profissional e data são obrigatórios.' });
    }

    try {
      const selectedDate = parseISO(date);
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);

      const pro = await prisma.user.findUnique({ where: { id: proId } });
      if (!pro) return res.status(404).json({ error: 'Profissional não encontrado.' });

      const appointments = await prisma.appointment.findMany({
        where: {
          proId,
          date: { gte: start, lte: end },
          status: { notIn: ['CANCELED', 'CANCELLED', 'NO_SHOW'] }
        }
      });

      const availableSlots = calcularHorariosLivres(selectedDate, appointments, pro);

      return res.json(availableSlots);
    } catch (error) {
      console.error("❌ Erro ao buscar slots:", error);
      return res.status(500).json({ error: 'Erro ao calcular horários disponíveis.' });
    }
  }
};