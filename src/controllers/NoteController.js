const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = {
  // Salvar ou Atualizar Nota (Upsert)
  async saveNote(req, res) {
    const { proId, clientId, content } = req.body;

    try {
      const note = await prisma.clientNote.upsert({
        where: {
          proId_clientId: {
            proId,
            clientId
          }
        },
        update: { content }, // Se já existe, atualiza
        create: { proId, clientId, content } // Se não existe, cria
      });

      return res.json(note);
    } catch (error) {
      console.log(error);
      return res.status(500).json({ error: 'Erro ao salvar nota' });
    }
  },

  // Buscar Nota
  async getNote(req, res) {
    const { proId, clientId } = req.query;

    try {
      const note = await prisma.clientNote.findUnique({
        where: {
          proId_clientId: {
            proId,
            clientId
          }
        }
      });
      // Retorna objeto vazio se não tiver nota
      return res.json(note || { content: '' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar nota' });
    }
  }
};