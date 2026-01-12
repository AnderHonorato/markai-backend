const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');

// Função de Geocodificação (Sem alterações, apenas mantida para funcionamento)
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
      const { 
        name, email, password, type, phone, cpf, 
        companyName, address, description, openHours 
      } = req.body;

      // Verifica se usuário já existe
      const userExists = await prisma.user.findUnique({ where: { email } });
      if (userExists) return res.status(400).json({ error: 'Email já cadastrado' });

      // Criação do usuário adaptada ao seu schema.prisma atual
      const user = await prisma.user.create({
        data: { 
          name, 
          email, 
          password, 
          type, 
          phone, 
          cpf,
          companyName: companyName || null,
          address: address || null,
          description: description || "Profissional parceiro Markaí",
          openHours: openHours || "Horário Comercial",
          // Campos com valores default do seu schema
          serviceDuration: 60,
          workStart: "09:00",
          workEnd: "18:00",
          reputationScore: 5.0
        }
      });

      console.log(`✅ Novo usuário criado: ${email} (${type})`);
      return res.json(user);
    } catch (error) { 
      console.error("❌ Erro ao criar usuário:", error.message);
      return res.status(500).json({ error: 'Erro ao criar usuário no banco de dados' }); 
    }
  },

  async login(req, res) {
    const { email, password } = req.body;
    try {
      // O Prisma buscará apenas os campos existentes no schema.prisma fornecido
      const user = await prisma.user.findUnique({ where: { email } });
      
      if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Email ou senha incorretos' });
      }

      if (user.isBlocked) {
        return res.status(403).json({ error: 'Sua conta está suspensa' });
      }

      return res.json({ 
        user, 
        token: 'token-ficticio-' + Math.random().toString(36).substr(2) 
      });
    } catch (error) { 
      console.error("❌ Erro no Login:", error.message);
      return res.status(500).json({ error: 'Erro interno ao processar login' }); 
    }
  },

  async getUser(req, res) {
    const { id } = req.params;
    try {
      const user = await prisma.user.findUnique({ 
        where: { id }, 
        include: { 
            services: true,
            _count: {
                select: {
                    reviewsReceived: true,
                    appointmentsAsClient: true,
                    appointmentsAsPro: true
                }
            }
        } 
      });
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar perfil' }); }
  },

  async listProfessionals(req, res) {
    try {
      const pros = await prisma.user.findMany({ 
        where: { type: 'PROFESSIONAL' },
        orderBy: { reputationScore: 'desc' }
      });
      return res.json(pros);
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar profissionais' }); }
  },

  async updateConfig(req, res) {
    const { id } = req.params;
    const body = req.body;

    try {
      const updateData = { ...body };
      
      // Sanitização de tipos para o Prisma
      if (body.serviceDuration) updateData.serviceDuration = parseInt(body.serviceDuration);
      if (body.fidelityGoal) updateData.fidelityGoal = parseInt(body.fidelityGoal);
      if (body.defaultFloat) updateData.defaultFloat = parseFloat(body.defaultFloat);

      // Geocodificação se o endereço mudar
      if (body.street && body.city) {
        const coords = await getCoordinates(body);
        if (coords) {
          updateData.latitude = coords.lat;
          updateData.longitude = coords.lng;
        }
      }

      const user = await prisma.user.update({ where: { id }, data: updateData });
      return res.json(user);
    } catch (error) { 
      return res.status(500).json({ error: 'Erro ao atualizar configurações' }); 
    }
  },

  async listNearby(req, res) {
    const { lat, lng } = req.query;
    try {
      const professionals = await prisma.user.findMany({
        where: { 
          type: 'PROFESSIONAL', 
          latitude: { not: null }, 
          longitude: { not: null } 
        }
      });

      if (!lat || !lng) return res.json(professionals);

      const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
      };

      const nearby = professionals.map(p => ({
        ...p,
        distance: calculateDistance(parseFloat(lat), parseFloat(lng), p.latitude, p.longitude)
      })).sort((a, b) => a.distance - b.distance);

      return res.json(nearby);
    } catch (error) { return res.status(500).json({ error: 'Erro na busca por proximidade' }); }
  }
};