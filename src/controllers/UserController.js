const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');

async function getCoordinates(data) {
  const headers = { 'User-Agent': 'MarkaiApp/1.0 (contato@markai.app)' };
  try {
    const addressQuery = `${data.street}, ${data.number}, ${data.city} - ${data.state}, Brazil`;
    let response = await axios.get(`https://nominatim.openstreetmap.org/search`, {
      params: { q: addressQuery, format: 'json', limit: 1 }, headers
    });
    if (response.data.length > 0) {
      return { lat: parseFloat(response.data[0].lat), lng: parseFloat(response.data[0].lon) };
    }
    return null;
  } catch (error) { return null; }
}

module.exports = {
  async create(req, res) {
    try {
      // Pegamos os dados que vêm do App
      const { 
        name, email, password, type, phone, cpf, 
        companyName, description, openHours,
        street, number, neighborhood, city, state, zipCode 
      } = req.body;

      const userExists = await prisma.user.findUnique({ 
        where: { email: email.toLowerCase() } 
      });
      
      if (userExists) return res.status(400).json({ error: 'Email já cadastrado' });

      // O ERRO ESTAVA AQUI: Removi o campo 'address' que não existe no seu schema.prisma
      const user = await prisma.user.create({
        data: { 
          name, 
          email: email.toLowerCase(), 
          password, 
          type, 
          phone, 
          cpf,
          companyName: companyName || null,
          description: description || "Profissional parceiro Markaí",
          openHours: openHours || "Horário Comercial",
          // Mapeando os campos de endereço corretamente para o Prisma
          street: street || null,
          number: number || null,
          neighborhood: neighborhood || null,
          city: city || null,
          state: state || null,
          zipCode: zipCode || null,
          // Padrões
          serviceDuration: 60, 
          workStart: "09:00", 
          workEnd: "18:00", 
          reputationScore: 5.0
        }
      });

      console.log(`✅ Usuário criado: ${email}`);
      return res.json(user);
    } catch (error) { 
      console.error("❌ Erro no Prisma:", error.message);
      return res.status(500).json({ error: 'Erro ao criar usuário no banco' }); 
    }
  },

  async login(req, res) {
    const { email, password } = req.body;
    try {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!user || user.password !== password) return res.status(401).json({ error: 'Email ou senha incorretos' });
      return res.json({ user, token: 'token-ficticio-' + Math.random().toString(36).substr(2) });
    } catch (error) { return res.status(500).json({ error: 'Erro no login' }); }
  },

  async getUser(req, res) {
    const { id } = req.params;
    try {
      const user = await prisma.user.findUnique({ 
        where: { id }, 
        include: { 
          services: true,
          _count: { select: { reviewsReceived: true, appointmentsAsClient: true, appointmentsAsPro: true } }
        } 
      });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro perfil' }); }
  },

  async listProfessionals(req, res) {
    try {
      const pros = await prisma.user.findMany({ where: { type: 'PROFESSIONAL' }, orderBy: { reputationScore: 'desc' } });
      return res.json(pros);
    } catch (error) { return res.status(500).json({ error: 'Erro profissionais' }); }
  },

  async updateConfig(req, res) {
    const { id } = req.params;
    const body = req.body;
    try {
      const updateData = { ...body };
      if (body.serviceDuration) updateData.serviceDuration = parseInt(body.serviceDuration);
      const user = await prisma.user.update({ where: { id }, data: updateData });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro update' }); }
  },

  async listNearby(req, res) {
    const { lat, lng } = req.query;
    try {
      const professionals = await prisma.user.findMany({ where: { type: 'PROFESSIONAL', latitude: { not: null }, longitude: { not: null } } });
      return res.json(professionals);
    } catch (error) { return res.status(500).json({ error: 'Erro nearby' }); }
  },

  async toggleBlock(req, res) {
    const { id } = req.params;
    const { proId } = req.body;
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      const updated = await prisma.user.update({
        where: { id },
        data: { isBlocked: !user.isBlocked, blockedBy: !user.isBlocked ? proId : null }
      });
      return res.json(updated);
    } catch (error) { return res.status(500).json({ error: 'Erro block' }); }
  },

  async getBySlug(req, res) {
    const { slug } = req.params;
    try {
      const user = await prisma.user.findUnique({ where: { slug }, include: { services: true } });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro slug' }); }
  }
};