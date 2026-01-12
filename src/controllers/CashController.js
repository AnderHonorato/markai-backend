const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { startOfDay, endOfDay } = require('date-fns');

module.exports = {
  // 1. Obter Status do Caixa do Dia (Com lógica de Automação)
  async getStatus(req, res) {
    const { userId } = req.params;
    const today = new Date();

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      
      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      let register = await prisma.cashRegister.findFirst({
        where: { 
          proId: userId,
          date: { gte: startOfDay(today), lte: endOfDay(today) }
        }
      });

      // --- LÓGICA DE AUTOMAÇÃO ---
      if (!register && user.autoOpenRegister) {
         // Prioriza horário específico do caixa, senão usa o de trabalho
         const timeToOpen = user.registerOpenTime || user.workStart || "09:00";
         const [h, m] = timeToOpen.split(':');
         
         const startTime = new Date();
         startTime.setHours(parseInt(h), parseInt(m), 0, 0);

         if (today >= startTime) {
             register = await prisma.cashRegister.create({
                 data: {
                     proId: userId,
                     initialValue: parseFloat(user.defaultFloat) || 0,
                     status: 'OPEN',
                     openedAt: new Date()
                 }
             });
         }
      }

      if (register) {
          // Busca todos os agendamentos concluídos de hoje para atualizar o faturamento
          const servicesToday = await prisma.appointment.findMany({
              where: {
                  proId: userId,
                  status: 'COMPLETED',
                  date: { gte: startOfDay(today), lte: endOfDay(today) }
              }
          });
          
          // Calcula o total garantindo que não retorne NaN
          const income = servicesToday.reduce((acc, curr) => {
              const price = parseFloat(curr.totalPrice) || 0;
              return acc + price;
          }, 0);
          
          if (register.status === 'OPEN') {
              register = await prisma.cashRegister.update({
                  where: { id: register.id },
                  data: { 
                      totalIncome: income,
                      finalValue: (parseFloat(register.initialValue) || 0) + income 
                  }
              });

              // Lógica de Fechamento Automático
              if (user.autoCloseRegister) {
                  const timeToClose = user.registerCloseTime || user.workEnd || "18:00";
                  const [hEnd, mEnd] = timeToClose.split(':');
                  
                  const endTime = new Date();
                  endTime.setHours(parseInt(hEnd), parseInt(mEnd), 0, 0);
                  
                  if (today >= endTime) {
                      register = await prisma.cashRegister.update({
                          where: { id: register.id },
                          data: { 
                              status: 'CLOSED', 
                              closedAt: new Date(),
                              finalValue: (parseFloat(register.initialValue) || 0) + income 
                          }
                      });
                  }
              }
          }
      }

      return res.json(register || { status: 'NOT_CREATED' });
    } catch (error) {
        console.error("Erro no getStatus do Caixa:", error);
        return res.status(500).json({ error: 'Erro ao buscar caixa' });
    }
  },

  // 2. Abrir Caixa Manualmente
  async open(req, res) {
    const { userId, initialValue } = req.body;
    try {
        const register = await prisma.cashRegister.create({
            data: { 
                proId: userId, 
                initialValue: parseFloat(initialValue) || 0, 
                status: 'OPEN',
                openedAt: new Date(),
                finalValue: parseFloat(initialValue) || 0
            }
        });
        return res.json(register);
    } catch (error) { 
        console.error(error);
        return res.status(500).json({ error: 'Erro ao abrir caixa' }); 
    }
  },

  // 3. Fechar Caixa Manualmente
  async close(req, res) {
    const { registerId } = req.body;
    try {
        const currentRegister = await prisma.cashRegister.findUnique({ where: { id: registerId } });
        
        const register = await prisma.cashRegister.update({
            where: { id: registerId },
            data: { 
                status: 'CLOSED', 
                closedAt: new Date(),
                // Garante que o valor final seja salvo corretamente no fechamento
                finalValue: currentRegister.initialValue + currentRegister.totalIncome
            }
        });
        return res.json(register);
    } catch (error) { 
        console.error(error);
        return res.status(500).json({ error: 'Erro ao fechar caixa' }); 
    }
  },

  // 4. Reabrir Caixa
  async reopen(req, res) {
    const { registerId } = req.body;
    try {
        const register = await prisma.cashRegister.update({
            where: { id: registerId },
            data: { 
                status: 'OPEN', 
                closedAt: null 
            }
        });
        return res.json(register);
    } catch (error) { 
        console.error(error);
        return res.status(500).json({ error: 'Erro ao reabrir caixa' }); 
    }
  }
};