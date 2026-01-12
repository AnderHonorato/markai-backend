const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando Seed - Zona Norte SP...');

  // 1. Barbeiro no Jaçanã
  const pro1 = await prisma.user.upsert({
    where: { email: 'jacana@barba.com' },
    update: {},
    create: {
      name: 'Ricardo Silva',
      email: 'jacana@barba.com',
      password: 'senha123',
      type: 'PROFESSIONAL',
      phone: '11988887777',
      companyName: 'Barbearia do Jaçanã',
      description: 'Corte clássico e barba com toalha quente no coração do Jaçanã.',
      street: 'Avenida Guapira',
      number: '2000',
      neighborhood: 'Jaçanã',
      city: 'São Paulo',
      state: 'SP',
      latitude: -23.4578,
      longitude: -46.5862,
      services: {
        create: [
          { name: 'Corte de Cabelo', price: 45.0, category: 'Cabelo' },
          { name: 'Barba Completa', price: 35.0, category: 'Barba' }
        ]
      }
    }
  });

  // 2. Manicure no Parque Edu Chaves
  const pro2 = await prisma.user.upsert({
    where: { email: 'edu@unhas.com' },
    update: {},
    create: {
      name: 'Camila Unhas',
      email: 'edu@unhas.com',
      password: 'senha123',
      type: 'PROFESSIONAL',
      phone: '11977776666',
      companyName: 'Studio Edu Chaves Nails',
      description: 'Especialista em unhas de fibra e esmaltação em gel.',
      street: 'Avenida Edu Chaves',
      number: '500',
      neighborhood: 'Parque Edu Chaves',
      city: 'São Paulo',
      state: 'SP',
      latitude: -23.4755,
      longitude: -46.5910,
      services: {
        create: [
          { name: 'Pé e Mão', price: 60.0, category: 'Geral' },
          { name: 'Alongamento Fibra', price: 150.0, category: 'Especial' }
        ]
      }
    }
  });

  // 3. Esteticista no Tucuruvi
  const pro3 = await prisma.user.upsert({
    where: { email: 'tucuruvi@estetica.com' },
    update: {},
    create: {
      name: 'Dra. Beatriz',
      email: 'tucuruvi@estetica.com',
      password: 'senha123',
      type: 'PROFESSIONAL',
      phone: '11966665555',
      companyName: 'Tucuruvi Estética & Bem Estar',
      description: 'Limpeza de pele e massagem relaxante ao lado do metrô.',
      street: 'Avenida Tucuruvi',
      number: '800',
      neighborhood: 'Tucuruvi',
      city: 'São Paulo',
      state: 'SP',
      latitude: -23.4801,
      longitude: -46.6038,
      services: {
        create: [
          { name: 'Limpeza de Pele', price: 120.0, category: 'Rosto' },
          { name: 'Drenagem Linfática', price: 90.0, category: 'Corpo' }
        ]
      }
    }
  });

  console.log('✅ Seed finalizado com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });