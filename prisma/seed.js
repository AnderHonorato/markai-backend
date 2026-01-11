const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Cria um Profissional (se não existir)
  const pro = await prisma.user.upsert({
    where: { email: 'barbeiro@teste.com' },
    update: {},
    create: {
      email: 'barbeiro@teste.com',
      password: '123',
      type: 'PROFESSIONAL',
      name: 'João Barbeiro',
      companyName: 'Barbearia do João',
    },
  });

  // 2. Cria um Cliente
  const client = await prisma.user.upsert({
    where: { email: 'cliente@teste.com' },
    update: {},
    create: {
      email: 'cliente@teste.com',
      password: '123',
      type: 'CLIENT',
      name: 'Maria Cliente',
      phone: '11999998888',
    },
  });

  // 3. Cria um Agendamento para HOJE às 15:00
  const hoje = new Date();
  hoje.setHours(15, 0, 0, 0);

  await prisma.appointment.create({
    data: {
      clientId: client.id,
      proId: pro.id,
      date: hoje,
      status: 'PENDING',
    },
  });

  console.log('Banco de dados populado com sucesso! 🌱');
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());