const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = {
  // Criar Serviço
  async create(req, res) {
    // Recebemos os dados do mobile, incluindo a imagem em Base64
    const { name, price, proId, category, imageUrl, description } = req.body;
    
    try {
      // Validação básica de campos obrigatórios
      if (!name || !price || !proId) {
        return res.status(400).json({ error: 'Nome, preço e ID do profissional são obrigatórios.' });
      }

      const service = await prisma.service.create({ 
        data: { 
          name, 
          // Garantimos que o preço seja um número flutuante
          price: parseFloat(price), 
          // proId é uma String (UUID) conforme seu schema
          proId, 
          category: category || "Geral", 
          imageUrl: imageUrl || null, 
          description: description || ""
        } 
      });

      console.log(`✅ Serviço "${name}" adicionado ao catálogo do pro: ${proId}`);
      return res.json(service);

    } catch (error) { 
      console.error("❌ Erro ao criar serviço:", error.message);
      
      // Caso o proId enviado não exista no banco de dados
      if (error.code === 'P2003') {
        return res.status(400).json({ error: 'Profissional não encontrado para este serviço.' });
      }

      return res.status(500).json({ error: 'Erro ao adicionar serviço ao catálogo.' }); 
    }
  },

  // Listar Serviços de um Profissional
  async listByPro(req, res) {
    const { proId } = req.params;
    
    try {
        const services = await prisma.service.findMany({ 
          where: { proId },
          // Organiza por categoria e depois por nome para ficar bonito no app
          orderBy: [
            { category: 'asc' },
            { name: 'asc' }
          ]
        });

        return res.json(services);
    } catch (error) {
        console.error("❌ Erro ao listar serviços:", error.message);
        return res.status(500).json({ error: 'Erro ao listar serviços do catálogo.' });
    }
  },

  // Deletar Serviço
  async delete(req, res) {
    const { id } = req.params;
    
    try {
      // Verificamos se o serviço existe antes de tentar deletar
      const serviceExists = await prisma.service.findUnique({ where: { id } });
      
      if (!serviceExists) {
        return res.status(404).json({ error: 'Serviço não encontrado.' });
      }

      await prisma.service.delete({ where: { id } });
      
      console.log(`🗑️ Serviço removido: ${id}`);
      return res.json({ success: true, message: 'Serviço removido com sucesso.' });

    } catch (error) { 
      console.error("❌ Erro ao deletar serviço:", error.message);
      return res.status(500).json({ error: 'Erro ao remover o serviço do catálogo.' }); 
    }
  }
};