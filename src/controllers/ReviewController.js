const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = {
  async create(req, res) {
    const { appointmentId, rating, comment, authorId, receiverId } = req.body;

    try {
      const existing = await prisma.review.findFirst({ 
        where: { appointmentId, authorId } 
      });
      if (existing) return res.status(400).json({ error: 'Você já avaliou este agendamento.' });

      const review = await prisma.review.create({
        data: {
          appointmentId,
          rating: parseInt(rating),
          comment,
          authorId,
          receiverId
        }
      });

      const allReviews = await prisma.review.findMany({ where: { receiverId } });
      const totalStars = allReviews.reduce((acc, curr) => acc + curr.rating, 0);
      const newScore = totalStars / allReviews.length;

      await prisma.user.update({
        where: { id: receiverId },
        data: { 
            reputationScore: newScore,
            totalReviews: allReviews.length
        }
      });

      return res.json(review);

    } catch (error) {
      console.log(error);
      return res.status(500).json({ error: 'Erro ao salvar avaliação' });
    }
  },

  // --- ALTERAÇÃO AQUI: INCLUDE AVATAR ---
  async list(req, res) {
    const { userId } = req.params;
    try {
        const reviews = await prisma.review.findMany({
            where: { receiverId: userId },
            include: { 
                author: { 
                    select: { 
                        name: true, 
                        companyName: true,
                        avatarUrl: true // Para mostrar a foto na lista
                    } 
                } 
            },
            orderBy: { createdAt: 'desc' }
        });
        return res.json(reviews);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar avaliações' });
    }
  }
};