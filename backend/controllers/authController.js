import User from '../models/User.js';
import jwt from 'jsonwebtoken';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'super_secret_querydesk_jwt_key_2026', {
    expiresIn: '30d'
  });
};

export const register = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const user = await User.create({ email, password });
    res.status(201).json({
      _id: user._id,
      email: user.email,
      onboarded: user.onboarded,
      token: generateToken(user._id)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password' });
    }

    const user = await User.findOne({ email });
    if (user && (await user.comparePassword(password))) {
      res.json({
        _id: user._id,
        email: user.email,
        onboarded: user.onboarded,
        token: generateToken(user._id)
      });
    } else {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const onboardUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.onboarded = true;
    await user.save();
    res.json({ success: true, onboarded: user.onboarded });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const autoLogin = async (req, res) => {
  try {
    const { guestKey } = req.body || {};
    let targetEmail = 'ac@gmail.com';
    if (guestKey && typeof guestKey === 'string' && guestKey.trim().length > 0) {
      targetEmail = `session_${guestKey.trim()}@querydesk.local`;
    }

    let user = await User.findOne({ email: targetEmail });

    if (!user) {
      user = await User.create({
        email: targetEmail,
        password: 'sessionpassword123',
        onboarded: true
      });
    } else if (!user.onboarded) {
      user.onboarded = true;
      await user.save();
    }

    res.json({
      _id: user._id,
      email: user.email,
      onboarded: true,
      token: generateToken(user._id)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
