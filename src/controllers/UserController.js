// backend/src/controllers/UserController.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const { enviarMensagem } = require('../bot'); 
const { enviarEmailVerificacao } = require('../services/email.service');

// Função auxiliar para coordenadas
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
  // 1. INICIAR REGISTRO (Envia código) - CORRIGIDO
  async registerIntent(req, res) {
    const { email, phone, verificationMethod, name, password, type, companyName, cpf } = req.body;
    
    console.log("📝 [REGISTRO] Iniciando cadastro...", { email, phone, verificationMethod });
    
    try {
      // Limpeza de dados segura
      const emailLower = email ? email.toLowerCase().trim() : '';
      const cleanPhone = phone ? phone.replace(/\D/g, '') : '';

      // Validação mínima para reenvio
      if (!emailLower) {
        return res.status(400).json({ error: 'Email é obrigatório.' });
      }

      console.log("🔍 [REGISTRO] Verificando se usuário já existe...");
      const existing = await prisma.user.findFirst({ 
        where: { 
          OR: [
            { email: emailLower }, 
            { phone: cleanPhone }
          ] 
        } 
      });
      
      // Se usuário já existe E está verificado, bloqueia
      if (existing && existing.isVerified) {
        console.log("❌ [REGISTRO] Usuário já cadastrado e verificado.");
        return res.status(400).json({ error: 'Usuário já cadastrado.' });
      }

      // Se usuário existe mas NÃO está verificado, permite reenvio
      if (existing && !existing.isVerified) {
        console.log("🔄 [REGISTRO] Usuário não verificado. Reenviando código...");
        
        const code = Math.floor(100000 + Math.random() * 900000).toString(); 
        const expires = new Date(Date.now() + 10 * 60000);

        // Atualiza apenas o código e expiração
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            verificationCode: code,
            codeExpiresAt: expires,
            verificationType: verificationMethod || existing.verificationType
          }
        });

        console.log("✅ [REGISTRO] Código atualizado:", code);

        // Tenta enviar o código
        let enviouComSucesso = false;
        
        try {
          if ((verificationMethod === 'PHONE' || existing.verificationType === 'PHONE') && (cleanPhone || existing.phone)) {
            const phoneToUse = cleanPhone || existing.phone;
            console.log("📱 [REGISTRO] Enviando via WhatsApp...");
            await enviarMensagem(phoneToUse, `🔐 *MARKAÍ - Código de Verificação*\n\nSeu código é: *${code}*\n\nVálido por 10 minutos.`, true);
            console.log("✅ [REGISTRO] WhatsApp enviado com sucesso!");
            enviouComSucesso = true;
          } else {
            console.log("📧 [REGISTRO] Enviando via Email...");
            await enviarEmailVerificacao(emailLower, code);
            console.log("✅ [REGISTRO] Email enviado com sucesso!");
            enviouComSucesso = true;
          }
        } catch (error) {
          console.error("❌ [REGISTRO] Erro no envio primário:", error.message);
          
          // Fallback
          try {
            if (verificationMethod === 'PHONE' || existing.verificationType === 'PHONE') {
              console.log("📧 [REGISTRO] Fallback: tentando email...");
              await enviarEmailVerificacao(emailLower, code);
              console.log("✅ [REGISTRO] Email enviado como fallback!");
              enviouComSucesso = true;
            } else {
              console.log("📱 [REGISTRO] Fallback: tentando WhatsApp...");
              if (cleanPhone || existing.phone) {
                const phoneToUse = cleanPhone || existing.phone;
                await enviarMensagem(phoneToUse, `🔐 *MARKAÍ - Código de Verificação*\n\nSeu código é: *${code}*\n\nVálido por 10 minutos.`, true);
                console.log("✅ [REGISTRO] WhatsApp enviado como fallback!");
                enviouComSucesso = true;
              }
            }
          } catch (fallbackError) {
            console.error("❌ [REGISTRO] Fallback também falhou:", fallbackError.message);
          }
        }

        if (!enviouComSucesso) {
          console.error("❌ [REGISTRO] Nenhum método de envio funcionou");
          return res.status(500).json({ error: 'Não foi possível enviar o código de verificação. Tente novamente.' });
        }

        return res.json({ success: true, expiresAt: expires });
      }

      // NOVO CADASTRO - Validações completas
      if (!name || !password || !cpf) {
        return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
      }

      if (verificationMethod === 'PHONE' && !cleanPhone) {
        return res.status(400).json({ error: 'Telefone é obrigatório para verificação via WhatsApp.' });
      }

      // Gera código de 6 dígitos
      const code = Math.floor(100000 + Math.random() * 900000).toString(); 
      const expires = new Date(Date.now() + 10 * 60000);

      console.log("💾 [REGISTRO] Criando novo usuário no banco...");
      await prisma.user.create({ 
        data: { 
          email: emailLower, 
          name, 
          password, 
          type, 
          companyName: companyName || "", 
          cpf, 
          phone: cleanPhone, 
          verificationCode: code, 
          codeExpiresAt: expires, 
          verificationType: verificationMethod, 
          isVerified: false 
        } 
      });

      console.log("✅ [REGISTRO] Usuário criado. Código gerado:", code);

      // Envio síncrono do código
      console.log("📤 [REGISTRO] Tentando enviar código...");
      
      let enviouComSucesso = false;
      
      try {
        if (verificationMethod === 'PHONE' && cleanPhone) {
          console.log("📱 [REGISTRO] Enviando via WhatsApp...");
          await enviarMensagem(cleanPhone, `🔐 *MARKAÍ - Código de Verificação*\n\nSeu código é: *${code}*\n\nVálido por 10 minutos.`, true);
          console.log("✅ [REGISTRO] WhatsApp enviado com sucesso!");
          enviouComSucesso = true;
        } else {
          console.log("📧 [REGISTRO] Enviando via Email...");
          await enviarEmailVerificacao(emailLower, code);
          console.log("✅ [REGISTRO] Email enviado com sucesso!");
          enviouComSucesso = true;
        }
      } catch (error) {
        console.error("❌ [REGISTRO] Erro no envio primário:", error.message);
        
        // Fallback: tentar outro método se falhar
        try {
          if (verificationMethod === 'PHONE') {
            console.log("📧 [REGISTRO] Fallback: tentando email...");
            await enviarEmailVerificacao(emailLower, code);
            console.log("✅ [REGISTRO] Email enviado como fallback!");
            enviouComSucesso = true;
          } else {
            console.log("📱 [REGISTRO] Fallback: tentando WhatsApp...");
            if (cleanPhone) {
              await enviarMensagem(cleanPhone, `🔐 *MARKAÍ - Código de Verificação*\n\nSeu código é: *${code}*\n\nVálido por 10 minutos.`, true);
              console.log("✅ [REGISTRO] WhatsApp enviado como fallback!");
              enviouComSucesso = true;
            }
          }
        } catch (fallbackError) {
          console.error("❌ [REGISTRO] Fallback também falhou:", fallbackError.message);
        }
      }

      if (!enviouComSucesso) {
        console.error("❌ [REGISTRO] Nenhum método de envio funcionou");
        return res.status(500).json({ error: 'Não foi possível enviar o código de verificação. Tente novamente.' });
      }

      res.json({ success: true, expiresAt: expires });

    } catch (error) { 
      console.error("💥 [REGISTRO] ERRO CRÍTICO:", error);
      console.error("Stack trace:", error.stack);
      return res.status(500).json({ error: 'Erro no cadastro.' }); 
    }
  },

  // 2. VERIFICAR CÓDIGO E ATIVAR CONTA
  async verifyRegistration(req, res) {
    const { email, code } = req.body;
    try {
      const emailFormatado = email ? email.toLowerCase().trim() : '';
      const user = await prisma.user.findFirst({ where: { email: emailFormatado, verificationCode: code } });
      
      if (!user) return res.status(400).json({ error: 'Código incorreto.' }); 
      if (user.codeExpiresAt && new Date() > user.codeExpiresAt) return res.status(400).json({ error: 'Código expirado.' });
      
      await prisma.user.update({ where: { id: user.id }, data: { isVerified: true, verificationCode: null, codeExpiresAt: null } }); 
      return res.json({ success: true });
    } catch (error) { return res.status(500).json({ error: 'Erro verificação.' }); }
  },

  // 3. LOGIN (CORRIGIDO)
  async login(req, res) {
    const { email, password } = req.body;
    
    console.log(`🔑 Tentativa de Login: ${email}`);

    try {
      if (!email || !password) return res.status(400).json({ error: 'Preencha email e senha.' });

      const emailLimpo = email.toLowerCase().trim();

      const user = await prisma.user.findUnique({ where: { email: emailLimpo } });
      
      if (!user) {
          console.log("❌ Usuário não encontrado no banco de dados.");
          return res.status(401).json({ error: 'Email não cadastrado.' });
      }

      if (user.password !== password) {
          console.log("❌ Senha incorreta.");
          return res.status(401).json({ error: 'Senha incorreta.' });
      }

      if (!user.isVerified) {
          console.log("⚠️ Usuário existe mas não verificou conta.");
          return res.status(403).json({ error: 'Conta não verificada.', needsVerification: true });
      }

      if (user.banExpiresAt && new Date(user.banExpiresAt) > new Date()) {
          console.log("🚫 Usuário banido.");
          return res.status(403).json({ error: 'Usuário banido.', bannedUntil: user.banExpiresAt, banReason: user.banReason });
      }

      console.log("✅ Login realizado com sucesso!");
      return res.json({ user, token: 'token-ficticio' });

    } catch (error) { 
        console.error("ERRO CRÍTICO NO LOGIN:", error);
        return res.status(500).json({ error: 'Erro interno no login' }); 
    }
  },

  // 4. RECUPERAR SENHA
  async forgotPassword(req, res) {
    const { contact } = req.body;
    try {
      const cleanContact = contact.trim();
      const cleanPhone = contact.replace(/\D/g, '');

      const user = await prisma.user.findFirst({ 
          where: { 
              OR: [
                  { email: cleanContact.toLowerCase() }, 
                  { cpf: cleanPhone }, 
                  { phone: cleanPhone }
              ] 
          } 
      });

      if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
      
      const code = Math.floor(100000 + Math.random() * 900000).toString(); 
      const expires = new Date(Date.now() + 10 * 60000);
      
      await prisma.user.update({ where: { id: user.id }, data: { verificationCode: code, codeExpiresAt: expires } });
      
      // Tenta enviar por WhatsApp primeiro
      let enviouComSucesso = false;
      try {
        if (user.phone) {
          await enviarMensagem(user.phone, `🔑 *MARKAI:* Recuperação: *${code}*`, true);
          enviouComSucesso = true;
        }
      } catch (error) {
        console.error("Erro ao enviar WhatsApp na recuperação:", error);
      }
      
      // Fallback para email se WhatsApp falhar ou não tiver phone
      if (!enviouComSucesso) {
        try {
          await enviarEmailVerificacao(user.email, code);
          enviouComSucesso = true;
        } catch (error) {
          console.error("Erro ao enviar email na recuperação:", error);
        }
      }
      
      if (!enviouComSucesso) {
        return res.status(500).json({ error: 'Não foi possível enviar o código de recuperação.' });
      }
      
      return res.json({ success: true, email: user.email });
    } catch (error) { return res.status(500).json({ error: 'Erro ao recuperar senha.' }); }
  },

  // 5. CRIAR USUÁRIO (Backoffice ou Teste)
  async create(req, res) {
    try {
      const { name, email, password, type, phone, cpf, companyName, description, openHours, avatarUrl, zipCode, street, number, neighborhood, city, state, complement } = req.body;
      
      const emailLower = email.toLowerCase().trim();
      const userExists = await prisma.user.findUnique({ where: { email: emailLower } }); 
      if (userExists) return res.status(400).json({ error: 'Email já cadastrado.' });
      
      const coords = await getCoordinates(req.body);
      
      const user = await prisma.user.create({ 
          data: { 
              name, 
              email: emailLower, 
              password, 
              type, 
              phone: phone ? phone.replace(/\D/g, '') : null, 
              cpf, 
              avatarUrl: avatarUrl || null, 
              companyName: companyName || null, 
              description: description || "Profissional parceiro Markaí", 
              openHours: openHours || "Horário Comercial", 
              zipCode, street, number, neighborhood, city, state, complement, 
              latitude: coords ? coords.lat : null, 
              longitude: coords ? coords.lng : null, 
              reputationScore: 5.0, 
              isVerified: true 
          } 
      });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro ao criar usuário.' }); }
  },

  // 6. ATUALIZAR CONFIGURAÇÕES
  async updateConfig(req, res) {
    const { id } = req.params;
    try {
      const updateData = { ...req.body };
      if (req.body.street || req.body.city) { 
          const coords = await getCoordinates(req.body); 
          if (coords) { updateData.latitude = coords.lat; updateData.longitude = coords.lng; } 
      }
      const user = await prisma.user.update({ where: { id }, data: updateData });
      return res.json(user);
    } catch (error) { return res.status(500).json({ error: 'Erro ao atualizar.' }); }
  },

  // 7. OBTER USUÁRIO
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
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar perfil.' }); }
  },

  // 8. LISTAR PROFISSIONAIS
  async listProfessionals(req, res) {
    try { 
        const pros = await prisma.user.findMany({ 
            where: { type: 'PROFESSIONAL' }, 
            orderBy: { reputationScore: 'desc' } 
        }); 
        return res.json(pros); 
    } catch (error) { return res.status(500).json({ error: 'Erro ao listar profissionais.' }); }
  },

  // 9. LISTAR PRÓXIMOS (GEO)
  async listNearby(req, res) {
    const { lat, lng, category } = req.query; 
    try {
      const professionals = await prisma.user.findMany({ 
          where: { 
              type: 'PROFESSIONAL', 
              latitude: { not: null }, 
              longitude: { not: null }, 
              ...(category && category !== 'Todos' && { categories: { has: category } }) 
          } 
      });
      
      if (!lat || !lng) return res.json(professionals);
      
      const calculateDistance = (lat1, lon1, lat2, lon2) => { 
          const R = 6371; 
          const dLat = (lat2 - lat1) * Math.PI / 180; 
          const dLon = (lon2 - lon1) * Math.PI / 180; 
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2); 
          return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); 
      };
      
      const nearby = professionals.map(p => ({ 
          ...p, 
          distance: calculateDistance(parseFloat(lat), parseFloat(lng), p.latitude, p.longitude) 
      })).sort((a, b) => a.distance - b.distance);
      
      return res.json(nearby);
    } catch (error) { return res.status(500).json({ error: 'Erro na busca por proximidade.' }); }
  },

  async toggleBlock(req, res) {
    const { id } = req.params; const { proId } = req.body;
    try { 
        const user = await prisma.user.findUnique({ where: { id } }); 
        const updated = await prisma.user.update({ 
            where: { id }, 
            data: { isBlocked: !user.isBlocked, blockedBy: !user.isBlocked ? proId : null } 
        }); 
        return res.json(updated); 
    } catch (error) { return res.status(500).json({ error: 'Erro ao bloquear.' }); }
  },

  async getBySlug(req, res) {
    const { slug } = req.params;
    try { 
        const user = await prisma.user.findUnique({ where: { slug }, include: { services: true } }); 
        return res.json(user); 
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar slug.' }); }
  },

  // ===========================================
  // SISTEMA DE DENÚNCIAS E ADMIN
  // ===========================================

  async createReport(req, res) {
    const { reportedId, reason, description, reporterId } = req.body;
    try {
      await prisma.report.create({ data: { reportedId, reporterId, reason, description, status: 'PENDING' } });
      return res.json({ message: 'Denúncia enviada com sucesso.' });
    } catch (error) { return res.status(500).json({ error: 'Erro ao denunciar.' }); }
  },

  async listReports(req, res) {
    const { requesterId, status } = req.query;
    if (!requesterId) return res.status(400).json({ error: 'ID necessário.' });
    try {
        const requester = await prisma.user.findUnique({ where: { id: requesterId } });
        if (!requester || (requester.email !== 'contato.markaiapp@gmail.com' && requester.role !== 'MODERATOR')) return res.status(403).json({ error: 'Sem permissão.' });
        
        let whereCondition = {};
        if (status === 'PENDING') whereCondition = { status: 'PENDING' };
        else if (status === 'HISTORY') whereCondition = { status: { not: 'PENDING' } };
        
        const reports = await prisma.report.findMany({ 
            where: whereCondition, 
            include: { 
                reporter: { select: { id: true, name: true, email: true } }, 
                reported: { select: { id: true, name: true, email: true, avatarUrl: true } }, 
                resolver: { select: { id: true, name: true } } 
            }, 
            orderBy: { createdAt: 'desc' } 
        });
        return res.json(reports);
    } catch (error) { return res.status(500).json({ error: 'Erro ao listar reports.' }); }
  },
        
 async resolveReport(req, res) {
      const { id } = req.params; const { status, requesterId } = req.body;
      if (!requesterId) return res.status(400).json({ error: 'ID admin necessário.' });
      try {
          const requester = await prisma.user.findUnique({ where: { id: requesterId } });
          const isOwner = requester?.email === 'contato.markaiapp@gmail.com'; const isMod = requester?.role === 'MODERATOR';
          if (!isOwner && !isMod) return res.status(403).json({ error: 'Sem permissão.' });
          
          const report = await prisma.report.update({ 
              where: { id }, 
              data: { status, resolverId: requesterId, resolvedAt: new Date() } 
          });
          return res.json(report);
      } catch (error) { return res.status(500).json({ error: 'Erro ao resolver.' }); }
  },

  async deleteReport(req, res) {
      const { id } = req.params; const { requesterId } = req.query;
      try {
          const requester = await prisma.user.findUnique({ where: { id: requesterId } });
          if (requester.email !== 'contato.markaiapp@gmail.com') return res.status(403).json({ error: 'Apenas Owner exclui.' });
          await prisma.report.delete({ where: { id } }); 
          return res.json({ message: 'Excluído.' });
      } catch (error) { return res.status(500).json({ error: 'Erro excluir.' }); }
  },

  async adminListUsers(req, res) {
    const { requesterId } = req.query;
    if (!requesterId) return res.status(400).json({ error: 'ID necessário.' });
    try {
      const requester = await prisma.user.findUnique({ where: { id: requesterId } });
      if (!requester || (requester.email !== 'contato.markaiapp@gmail.com' && requester.role !== 'MODERATOR')) return res.status(403).json({ error: 'Sem permissão.' });
      
      const users = await prisma.user.findMany({ 
          orderBy: { createdAt: 'desc' }, 
          select: { id: true, name: true, companyName: true, email: true, type: true, role: true, isVerified: true, banExpiresAt: true, banReason: true, avatarUrl: true, createdAt: true } 
      });
      return res.json(users);
    } catch (error) { return res.status(500).json({ error: 'Erro lista admin.' }); }
  },

  async adminGetStats(req, res) {
      const { requesterId } = req.query;
      try {
          const requester = await prisma.user.findUnique({ where: { id: requesterId } });
          if (!requester || (requester.email !== 'contato.markaiapp@gmail.com' && requester.role !== 'MODERATOR')) return res.status(403).json({ error: 'Sem permissão.' });

          const now = new Date();
          const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

          const [totalUsers, usersThisMonth, usersLastMonth, totalBans, bansThisMonth, bansLastMonth] = await Promise.all([
              prisma.user.count(),
              prisma.user.count({ where: { createdAt: { gte: startThisMonth } } }),
              prisma.user.count({ where: { createdAt: { gte: startLastMonth, lt: startThisMonth } } }),
              prisma.adminLog.count({ where: { action: 'BAN' } }),
              prisma.adminLog.count({ where: { action: 'BAN', createdAt: { gte: startThisMonth } } }),
              prisma.adminLog.count({ where: { action: 'BAN', createdAt: { gte: startLastMonth, lt: startThisMonth } } })
          ]);

          return res.json({
              users: { total: totalUsers, current: usersThisMonth, previous: usersLastMonth },
              bans: { total: totalBans, current: bansThisMonth, previous: bansLastMonth }
          });
      } catch (error) { return res.status(500).json({ error: 'Erro stats.' }); }
  },

  async adminBanUser(req, res) {
    const { id } = req.params;
    const { requesterId, days, reason, reportId } = req.body; 
    
    if (!requesterId) return res.status(400).json({ error: 'ID admin necessário.' });

    try {
      const requester = await prisma.user.findUnique({ where: { id: requesterId } });
      const isOwner = requester.email === 'contato.markaiapp@gmail.com';
      const isMod = requester.role === 'MODERATOR';

      if (!isOwner && !isMod) return res.status(403).json({ error: 'Acesso negado.' });

      const target = await prisma.user.findUnique({ where: { id } });
      if (target.email === 'contato.markaiapp@gmail.com') return res.status(403).json({ error: 'Impossível banir o Owner.' });

      let banDate = null;
      let finalReason = null;
      if (days && parseInt(days) > 0) {
        const date = new Date();
        date.setDate(date.getDate() + parseInt(days));
        banDate = date;
        finalReason = reason || "Violação das regras.";
      }

      const updated = await prisma.user.update({
        where: { id },
        data: { banExpiresAt: banDate, banReason: finalReason }
      });

      if (reportId && banDate) {
          const report = await prisma.report.findUnique({ where: { id: reportId } });
          if (report) {
              await prisma.report.update({ 
                  where: { id: reportId }, 
                  data: { status: 'RESOLVED', resolverId: requesterId, resolvedAt: new Date() } 
              });
              await prisma.user.update({
                  where: { id: report.reporterId },
                  data: { activeFeedback: `Obrigado! Sua denúncia contra ${target.name} foi analisada e uma medida foi tomada. Você ajuda a manter nossa comunidade segura.` }
              });
          }
      }

      await prisma.adminLog.create({
        data: {
            action: banDate ? 'BAN' : 'UNBAN',
            details: banDate ? `Dias: ${days}. Motivo: ${finalReason}` : 'Banimento removido.',
            adminId: requesterId,
            targetId: id
        }
      });

      return res.json(updated);
    } catch (error) { return res.status(500).json({ error: 'Erro ao banir.' }); }
  },

  async adminToggleVerify(req, res) {
    const { id } = req.params; const { requesterId } = req.body;
    if (!requesterId) return res.status(400).json({ error: 'ID admin necessário.' });
    try {
      const requester = await prisma.user.findUnique({ where: { id: requesterId } });
      const isOwner = requester.email === 'contato.markaiapp@gmail.com'; const isMod = requester.role === 'MODERATOR';
      if (!isOwner && !isMod) return res.status(403).json({ error: 'Acesso negado.' });
      
      const target = await prisma.user.findUnique({ where: { id } });
      if (target.email === 'contato.markaiapp@gmail.com' && !isOwner) return res.status(403).json({ error: 'Sem permissão.' });
      
      const updated = await prisma.user.update({ where: { id }, data: { isVerified: !target.isVerified } });
      await prisma.adminLog.create({ data: { action: !target.isVerified ? 'VERIFY' : 'REVOKE', details: 'Alteração de selo', adminId: requesterId, targetId: id } });
      return res.json(updated);
    } catch (error) { return res.status(500).json({ error: 'Erro verificação.' }); }
  },

  async adminDeleteUser(req, res) {
    const { id } = req.params; const { requesterId } = req.query;
    if (!requesterId) return res.status(400).json({ error: 'ID admin necessário.' });
    try {
      const requester = await prisma.user.findUnique({ where: { id: requesterId } });
      if (requester.email !== 'contato.markaiapp@gmail.com') return res.status(403).json({ error: 'Apenas o Owner deleta.' });
      
      await prisma.appointment.deleteMany({ where: { OR: [{ clientId: id }, { proId: id }] } });
      await prisma.review.deleteMany({ where: { OR: [{ authorId: id }, { receiverId: id }] } });
      await prisma.chatMessage.deleteMany({ where: { OR: [{ senderId: id }, { receiverId: id }] } });
      await prisma.report.deleteMany({ where: { OR: [{ reporterId: id }, { reportedId: id }] } });
      await prisma.adminLog.deleteMany({ where: { OR: [{ adminId: id }, { targetId: id }] } });
      await prisma.user.delete({ where: { id } });
      
      return res.json({ message: 'Conta deletada.' });
    } catch (error) { return res.status(500).json({ error: 'Erro ao deletar.' }); }
  },

  async adminToggleMod(req, res) {
    const { id } = req.params; const { requesterId } = req.body;
    if (!requesterId) return res.status(400).json({ error: 'ID admin necessário.' });
    try {
      const requester = await prisma.user.findUnique({ where: { id: requesterId } });
      if (requester.email !== 'contato.markaiapp@gmail.com') return res.status(403).json({ error: 'Apenas o Owner promove.' });
      
      const target = await prisma.user.findUnique({ where: { id } });
      const newRole = target.role === 'MODERATOR' ? 'USER' : 'MODERATOR';
      
      const updated = await prisma.user.update({ where: { id }, data: { role: newRole } });
      await prisma.adminLog.create({ data: { action: 'PROMOTE', details: `Novo cargo: ${newRole}`, adminId: requesterId, targetId: id } });
      return res.json(updated);
    } catch (error) { return res.status(500).json({ error: 'Erro cargo.' }); }
  },

  async adminWarnUser(req, res) {
    const { id } = req.params;
    const { requesterId, message, reportId } = req.body;

    if (!requesterId || !message) return res.status(400).json({ error: 'Dados incompletos.' });

    try {
      const requester = await prisma.user.findUnique({ where: { id: requesterId } });
      const isOwner = requester?.email === 'contato.markaiapp@gmail.com';
      const isMod = requester?.role === 'MODERATOR';

      if (!isOwner && !isMod) return res.status(403).json({ error: 'Sem permissão.' });

      await prisma.user.update({ where: { id }, data: { activeWarning: message } });

      if (reportId) {
        await prisma.report.update({ where: { id: reportId }, data: { status: 'RESOLVED', resolverId: requesterId, resolvedAt: new Date() } });
      }

      await prisma.adminLog.create({ data: { action: 'WARN', details: `Advertência: "${message}"`, adminId: requesterId, targetId: id } });

      return res.json({ message: 'Advertência enviada.' });
    } catch (error) { return res.status(500).json({ error: 'Erro ao advertir.' }); }
  },

  async dismissWarning(req, res) {
      const { id } = req.params;
      try {
          await prisma.user.update({ where: { id }, data: { activeWarning: null } });
          return res.json({ success: true });
      } catch (error) { return res.status(500).json({ error: 'Erro ao limpar.' }); }
  },

  async dismissFeedback(req, res) {
      const { id } = req.params;
      try {
          await prisma.user.update({ where: { id }, data: { activeFeedback: null } });
          return res.json({ success: true });
      } catch (error) { return res.status(500).json({ error: 'Erro ao limpar.' }); }
  },
  async adminSendGlobalMessage(req, res) {
    const { requesterId, message, type, targetGroup } = req.body;

    if (!requesterId || !message) {
      return res.status(400).json({ error: 'Dados incompletos.' });
    }

    try {
      const requester = await prisma.user.findUnique({ where: { id: requesterId } });
      const isOwner = requester?.email === 'contato.markaiapp@gmail.com';
      const isMod = requester?.role === 'MODERATOR';

      if (!isOwner && !isMod) {
        return res.status(403).json({ error: 'Sem permissão.' });
      }

      let whereCondition = {};
      if (targetGroup === 'professionals') whereCondition = { type: 'PROFESSIONAL' };
      else if (targetGroup === 'clients') whereCondition = { type: 'CLIENT' };
      else if (targetGroup === 'verified') whereCondition = { isVerified: true };
      else if (targetGroup === 'unverified') whereCondition = { isVerified: false };

      const users = await prisma.user.findMany({ where: whereCondition, select: { id: true } });

      const notificationField = type === 'warning' ? 'activeWarning' : 'activeFeedback';

      await Promise.all(users.map(user => 
        prisma.user.update({
          where: { id: user.id },
          data: { [notificationField]: message }
        })
      ));

      await prisma.adminLog.create({
        data: {
          action: 'GLOBAL_MESSAGE',
          details: `Tipo: ${type}, Grupo: ${targetGroup || 'all'}, Msg: "${message.substring(0, 50)}"`,
          adminId: requesterId,
          targetId: null
        }
      });

      return res.json({ success: true, sentTo: users.length });

    } catch (error) {
      console.error('Erro ao enviar mensagem global:', error);
      return res.status(500).json({ error: 'Erro ao enviar mensagem global.' });
    }
  },

  async adminClearGlobalMessages(req, res) {
    const { requesterId, type } = req.body;

    if (!requesterId) return res.status(400).json({ error: 'ID admin necessário.' });

    try {
      const requester = await prisma.user.findUnique({ where: { id: requesterId } });
      
      if (requester?.email !== 'contato.markaiapp@gmail.com') {
        return res.status(403).json({ error: 'Apenas o Owner pode limpar mensagens globais.' });
      }

      let updateData = {};
      if (type === 'warning' || type === 'all') updateData.activeWarning = null;
      if (type === 'info' || type === 'all') updateData.activeFeedback = null;

      const result = await prisma.user.updateMany({ data: updateData });

      return res.json({ success: true, cleared: result.count });

    } catch (error) {
      return res.status(500).json({ error: 'Erro ao limpar mensagens.' });
    }
  },

  async adminGetMessageStats(req, res) {
    const { requesterId } = req.query;

    if (!requesterId) return res.status(400).json({ error: 'ID necessário.' });

    try {
      const requester = await prisma.user.findUnique({ where: { id: requesterId } });
      
      if (!requester || (requester.email !== 'contato.markaiapp@gmail.com' && requester.role !== 'MODERATOR')) {
        return res.status(403).json({ error: 'Sem permissão.' });
      }

      const [warningsCount, feedbackCount] = await Promise.all([
        prisma.user.count({ where: { activeWarning: { not: null } } }),
        prisma.user.count({ where: { activeFeedback: { not: null } } })
      ]);

      return res.json({
        activeWarnings: warningsCount,
        activeFeedback: feedbackCount,
        total: warningsCount + feedbackCount
      });

    } catch (error) {
      return res.status(500).json({ error: 'Erro ao obter estatísticas.' });
    }
  },
 
};        
