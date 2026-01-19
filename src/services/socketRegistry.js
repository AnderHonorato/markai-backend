const socketsByProfessional = {};

function setSocket(professionalId, sock) {
  socketsByProfessional[professionalId] = sock;
}

function getSocket(professionalId) {
  return socketsByProfessional[professionalId];
}

module.exports = {
  setSocket,
  getSocket
};
