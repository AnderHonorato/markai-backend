const express = require('express');
const routes = express.Router();
const UserController = require('./controllers/UserController');
const ServiceController = require('./controllers/ServiceController');
const AppointmentController = require('./controllers/AppointmentController');
const ChatController = require('./controllers/ChatController');
const ReviewController = require('./controllers/ReviewController'); 
const CashController = require('./controllers/CashController');
const NoteController = require('./controllers/NoteController');

routes.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// USUÁRIOS
routes.post('/users', UserController.create);
routes.post('/login', UserController.login);
routes.get('/professionals', UserController.listProfessionals);
routes.get('/users/nearby', UserController.listNearby); 
routes.patch('/users/:id/config', UserController.updateConfig);
routes.patch('/users/:id/block', UserController.toggleBlock);
routes.get('/users/:id', UserController.getUser); 

// SERVIÇOS
routes.post('/services', ServiceController.create);
routes.get('/services/:proId', ServiceController.listByPro);
routes.delete('/services/:id', ServiceController.delete);

// AGENDAMENTOS
routes.post('/appointments', AppointmentController.create);
routes.get('/appointments', AppointmentController.list);
routes.patch('/appointments/:id/confirm', AppointmentController.confirm); 
routes.post('/appointments/:id/cancel', AppointmentController.cancel);
routes.post('/appointments/:id/finish', AppointmentController.finish);
routes.post('/appointments/:id/propose', AppointmentController.propose);
routes.post('/appointments/:id/respond', AppointmentController.respond);

// AVALIAÇÕES
routes.post('/reviews', ReviewController.create);
routes.get('/reviews/:userId', ReviewController.list);

// CHAT E IA
routes.post('/ai/chat', ChatController.aiChat);
routes.get('/messages/:userId/:otherId', ChatController.listMessages);
routes.post('/messages', ChatController.sendMessage);

// FINANCEIRO
routes.get('/cash/:userId', CashController.getStatus);
routes.post('/cash/open', CashController.open);
routes.post('/cash/close', CashController.close);
routes.post('/cash/reopen', CashController.reopen);

// NOTAS PRIVADAS
routes.post('/notes', NoteController.saveNote);
routes.get('/notes', NoteController.getNote);

// SLUG
routes.get('/:slug', UserController.getBySlug); 

console.log('✅ Rotas carregadas com sucesso');
module.exports = routes;