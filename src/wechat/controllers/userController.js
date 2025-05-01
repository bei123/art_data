const UserService = require('../services/userService');

class UserController {
  static async login(req, res) {
    try {
      const { code } = req.body;
      const result = await UserService.login(code);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  static async getPhoneNumber(req, res) {
    try {
      const { code } = req.body;
      const phoneNumber = await UserService.getPhoneNumber(code);
      res.json({ phoneNumber });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  static async bindUserInfo(req, res) {
    try {
      const userId = req.user.userId;
      const result = await UserService.bindUserInfo(userId, req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  static async getUserInfo(req, res) {
    try {
      const userId = req.user.userId;
      const userInfo = await UserService.getUserInfo(userId);
      res.json(userInfo);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
}

module.exports = UserController; 