// backend/src/server.js
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { startBot, enviarMensagem } = require('./bot'); 
const { gerarRespostaIA } = require('./services/ai.service');

const app = express();
const prisma = new PrismaClient();

app.use(express.json());
app.use(cors());

// ==========================================
// 1. ROTAS DE USUÁRIO
// ==========================================
app.post('/users', async (req, res) => {
  try {
    const { name, email, password, type, phone, companyName, cpf, description, openHours, address, workStart, workEnd, serviceDuration } = req.body;
    const userExists = await prisma.user.findUnique({ where: { email } });
    if (userExists) return res.status(400).json({ error: 'Email já cadastrado' });

    const user = await prisma.user.create({
      data: { name, email, password, type, phone, companyName, cpf, description, openHours, address, workStart: workStart || "09:00", workEnd: workEnd || "18:00", serviceDuration: serviceDuration ? parseInt(serviceDuration) : 60, reputationScore: 5.0 }
    });
    res.json(user);
  } catch (error) { res.status(500).json({ error: 'Erro ao criar usuário' }); }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.password !== password) return res.status(401).json({ error: 'Credenciais inválidas' });
  res.json(user);
});

app.get('/professionals', async (req, res) => {
  const pros = await prisma.user.findMany({ 
    where: { type: 'PROFESSIONAL' },
    select: { id: true, name: true, companyName: true, description: true, address: true, openHours: true, phone: true, workStart: true, workEnd: true, serviceDuration: true, reputationScore: true, services: true }
  });
  res.json(pros);
});

app.patch('/users/:id/config', async (req, res) => {
  const { id } = req.params;
  const { workStart, workEnd, serviceDuration, companyName, address } = req.body;
  try {
    const user = await prisma.user.update({ where: { id }, data: { workStart, workEnd, serviceDuration: parseInt(serviceDuration), companyName, address } });
    res.json(user);
  } catch (error) { res.status(500).json({ error: 'Erro ao atualizar' }); }
});

// ==========================================
// 2. ROTAS DE SERVIÇOS
// ==========================================
app.post('/services', async (req, res) => {
  const { name, price, proId } = req.body;
  try {
    const service = await prisma.service.create({ data: { name, price: parseFloat(price), proId } });
    res.json(service);
  } catch (error) { res.status(500).json({ error: 'Erro ao adicionar' }); }
});

app.delete('/services/:id', async (req, res) => {
  try {
    await prisma.service.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao remover' }); }
});

// ==========================================
// 3. ROTAS DE AGENDAMENTO
// ==========================================
app.post('/appointments', async (req, res) => {
  const { clientId, proId, date } = req.body;
  try {
    const pro = await prisma.user.findUnique({ where: { id: proId } });
    const duration = pro.serviceDuration || 60;
    const newStart = new Date(date);
    const newEnd = new Date(newStart.getTime() + duration * 60000); 

    const conflicts = await prisma.appointment.findMany({
        where: { proId, status: { not: 'CANCELED' }, date: { gte: new Date(newStart.getTime() - duration * 60000), lte: newEnd } }
    });

    if (conflicts.some(appt => {
        const s = new Date(appt.date); const e = new Date(s.getTime() + duration * 60000);
        return (newStart < e && newEnd > s);
    })) return res.status(400).json({ error: 'Conflito de horário' });

    const appointment = await prisma.appointment.create({ data: { clientId, proId, date: newStart, status: 'PENDING' } });
    res.json(appointment);
  } catch (error) { res.status(500).json({ error: 'Erro ao agendar' }); }
});

app.get('/appointments', async (req, res) => {
  const { userId, type } = req.query;
  const where = type === 'PROFESSIONAL' ? { proId: userId } : { clientId: userId };
  try {
    const appointments = await prisma.appointment.findMany({ where, include: { client: true, professional: true }, orderBy: { date: 'asc' } });
    const result = appointments.map(app => ({ ...app, isRiskyClient: (app.client.noShowCount > 2 || app.client.reputationScore < 3.0) }));
    res.json(result);
  } catch (error) { res.status(500).json({ error: 'Erro ao buscar' }); }
});

app.patch('/appointments/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const appointment = await prisma.appointment.update({ where: { id }, data: { status }, include: { client: true, professional: true } });
    if (appointment.client.phone) {
        const tel = appointment.client.phone.replace(/\D/g, '');
        let msg = status === 'CONFIRMED' ? `Agendamento CONFIRMADO em ${appointment.professional.companyName}!` : `Agendamento CANCELADO em ${appointment.professional.companyName}.`;
        enviarMensagem(tel, msg);
    }
    res.json(appointment);
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/appointments/:id/reschedule', async (req, res) => {
  const { id } = req.params;
  const { newDate, reason, byWho } = req.body;
  try {
    const appt = await prisma.appointment.update({ where: { id }, data: { status: 'RESCHEDULE_REQ', rescheduleDate: new Date(newDate), rescheduleReason: reason, rescheduleBy: byWho }, include: { client: true, professional: true } });
    const target = byWho === 'PRO' ? appt.client : appt.professional;
    if(target.phone) enviarMensagem(target.phone.replace(/\D/g, ''), `Solicitação de reagendamento: ${reason}`);
    res.json(appt);
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/appointments/:id/finish', async (req, res) => {
  const { id } = req.params;
  const { attended } = req.body;
  try {
    const appt = await prisma.appointment.update({ where: { id }, data: { status: attended ? 'COMPLETED' : 'NO_SHOW' }, include: { client: true } });
    const updateData = attended ? { totalAppointments: { increment: 1 }, reputationScore: Math.min(appt.client.reputationScore + 0.1, 5.0) } : { noShowCount: { increment: 1 }, reputationScore: { decrement: 0.5 } };
    await prisma.user.update({ where: { id: appt.client.id }, data: updateData });
    res.json(appt);
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

// ==========================================
// 4. CHAT E IA
// ==========================================
app.post('/messages', async (req, res) => {
  const { senderId, receiverId, content } = req.body;
  try { const msg = await prisma.chatMessage.create({ data: { senderId, receiverId, content } }); res.json(msg); } 
  catch (e) { res.status(500).json({ error: 'Erro' }); }
});

app.get('/messages/:userId/:otherId', async (req, res) => {
  const { userId, otherId } = req.params;
  try {
    const msgs = await prisma.chatMessage.findMany({
      where: { OR: [{ senderId: userId, receiverId: otherId }, { senderId: otherId, receiverId: userId }] },
      orderBy: { createdAt: 'asc' }
    });
    res.json(msgs);
  } catch (e) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/ai/chat', async (req, res) => {
  const { message, userId } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { appointmentsAsClient: { include: { professional: true } } } });
    const responseText = await gerarRespostaIA(message, {
        nomeUsuario: user ? user.name : 'Usuário',
        agendamentos: user ? user.appointmentsAsClient : []
    });
    if (responseText.includes('[ENCERRAR]')) { return res.json({ response: "Entendi. Se precisar agendar algo, estou por aqui! 👋" }); }
    res.json({ response: responseText });
  } catch (error) { res.status(500).json({ error: 'Erro na IA' }); }
});

startBot();
const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Servidor V5 (Com Notificações) rodando na porta ${PORT}`));