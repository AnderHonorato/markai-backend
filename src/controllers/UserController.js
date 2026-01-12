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
      const { name, email, password, type, phone, cpf, companyName, address, description, openHours } = req.body;
      const userExists = await prisma.user.findUnique({ where: { email } });
      if (userExists) return res.status(400).json({ error: 'Email já cadastrado' });

      const user = await prisma.user.create({
        data: { 
          name, email, password, type, phone, cpf,
          companyName: companyName || null,
          address: address || null,
          description: description || "Profissional parceiro Markaí",
          openHours: openHours || "Horário Comercial",
          serviceDuration: 60, workStart: "09:00", workEnd: "18:00", reputationScore: 5.0
        }
      });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro ao criar usuário' }); }
  },

  async login(req, res) {
    const { email, password } = req.body;
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || user.password !== password) return res.status(401).json({ error: 'Email ou senha incorretos' });
      if (user.isBlocked) return res.status(403).json({ error: 'Sua conta está suspensa' });
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
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar perfil' }); }
  },

  async listProfessionals(req, res) {
    try {
      const pros = await prisma.user.findMany({ where: { type: 'PROFESSIONAL' }, orderBy: { reputationScore: 'desc' } });
      return res.json(pros);
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar profissionais' }); }
  },

  async updateConfig(req, res) {
    const { id } = req.params;
    const body = req.body;
    try {
      const updateData = { ...body };
      if (body.serviceDuration) updateData.serviceDuration = parseInt(body.serviceDuration);
      if (body.street && body.city) {
        const coords = await getCoordinates(body);
        if (coords) { updateData.latitude = coords.lat; updateData.longitude = coords.lng; }
      }
      const user = await prisma.user.update({ where: { id }, data: updateData });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro ao atualizar' }); }
  },

  async listNearby(req, res) {
    const { lat, lng } = req.query;
    try {
      const professionals = await prisma.user.findMany({ where: { type: 'PROFESSIONAL', latitude: { not: null }, longitude: { not: null } } });
      if (!lat || !lng) return res.json(professionals);
      const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
        return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
      };
      const nearby = professionals.map(p => ({ ...p, distance: calculateDistance(parseFloat(lat), parseFloat(lng), p.latitude, p.longitude) })).sort((a, b) => a.distance - b.distance);
      return res.json(nearby);
    } catch (error) { return res.status(500).json({ error: 'Erro na busca' }); }
  },

  // FUNÇÃO QUE FALTAVA
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
    } catch (error) { return res.status(500).json({ error: 'Erro ao bloquear' }); }
  },

  // FUNÇÃO QUE FALTAVA
  async getBySlug(req, res) {
    const { slug } = req.params;
    try {
      const user = await prisma.user.findUnique({ where: { slug }, include: { services: true } });
      if (!user) return res.status(404).json({ error: 'Perfil não encontrado' });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar slug' }); }
  }
};