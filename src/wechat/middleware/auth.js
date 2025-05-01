const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: '未登录' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, 'your_jwt_secret');
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token无效' });
  }
};

module.exports = {
  authenticateToken
}; 