const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// User storage (in production, use a proper database)
const users = new Map();
const userSessions = new Map();
const teams = new Map();
const teamMembers = new Map();
const userProjects = new Map();

// JWT secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// JWT middleware for protected routes
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// User registration
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, fullName } = req.body;
    
    // Validate input
    if (!username || !email || !password || !fullName) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Check if user already exists
    if (users.has(username) || Array.from(users.values()).some(u => u.email === email)) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = {
      id: uuidv4(),
      username,
      email,
      password: hashedPassword,
      fullName,
      createdAt: Date.now(),
      isActive: true,
      role: 'user'
    };
    
    users.set(username, user);
    userProjects.set(user.id, []);
    
    // Create default team for user
    const team = {
      id: uuidv4(),
      name: `${fullName}'s Team`,
      description: 'Personal team',
      ownerId: user.id,
      createdAt: Date.now(),
      isPersonal: true
    };
    
    teams.set(team.id, team);
    teamMembers.set(team.id, [{
      userId: user.id,
      role: 'owner',
      joinedAt: Date.now()
    }]);
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      token,
      team: {
        id: team.id,
        name: team.name
      }
    });
    
    console.log(`✅ User registered: ${username}`);
    
  } catch (error) {
    console.error('Error in user registration:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Find user
    const user = users.get(username);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Store session
    userSessions.set(user.id, {
      token,
      lastActivity: Date.now(),
      ip: req.ip
    });
    
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      token
    });
    
    console.log(`✅ User logged in: ${username}`);
    
  } catch (error) {
    console.error('Error in user login:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get user profile
router.get('/profile', authenticateToken, (req, res) => {
  try {
    const user = users.get(req.user.username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { fullName, email } = req.body;
    const user = users.get(req.user.username);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update fields
    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      }
    });
    
    console.log(`✅ Profile updated: ${user.username}`);
    
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
router.put('/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = users.get(req.user.username);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    user.password = await bcrypt.hash(newPassword, 10);
    
    res.json({ message: 'Password changed successfully' });
    
    console.log(`✅ Password changed: ${user.username}`);
    
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Logout
router.post('/logout', authenticateToken, (req, res) => {
  try {
    userSessions.delete(req.user.userId);
    
    res.json({ message: 'Logged out successfully' });
    
    console.log(`✅ User logged out: ${req.user.username}`);
    
  } catch (error) {
    console.error('Error in logout:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Team Management
router.post('/teams', authenticateToken, (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Team name is required' });
    }
    
    const team = {
      id: uuidv4(),
      name,
      description: description || '',
      ownerId: req.user.userId,
      createdAt: Date.now(),
      isPersonal: false
    };
    
    teams.set(team.id, team);
    teamMembers.set(team.id, [{
      userId: req.user.userId,
      role: 'owner',
      joinedAt: Date.now()
    }]);
    
    res.status(201).json({
      message: 'Team created successfully',
      team
    });
    
    console.log(`✅ Team created: ${name} by ${req.user.username}`);
    
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// Get user's teams
router.get('/teams', authenticateToken, (req, res) => {
  try {
    const userTeams = [];
    
    for (const [teamId, members] of teamMembers.entries()) {
      const member = members.find(m => m.userId === req.user.userId);
      if (member) {
        const team = teams.get(teamId);
        if (team) {
          userTeams.push({
            ...team,
            userRole: member.role,
            memberCount: members.length
          });
        }
      }
    }
    
    res.json({ teams: userTeams });
  } catch (error) {
    console.error('Error getting teams:', error);
    res.status(500).json({ error: 'Failed to get teams' });
  }
});

// Get team details
router.get('/teams/:teamId', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const team = teams.get(teamId);
    
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const members = teamMembers.get(teamId) || [];
    const isMember = members.some(m => m.userId === req.user.userId);
    
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const memberDetails = members.map(member => {
      const user = Array.from(users.values()).find(u => u.id === member.userId);
      return {
        userId: member.userId,
        username: user ? user.username : 'Unknown',
        fullName: user ? user.fullName : 'Unknown',
        role: member.role,
        joinedAt: member.joinedAt
      };
    });
    
    res.json({
      team: {
        ...team,
        members: memberDetails
      }
    });
  } catch (error) {
    console.error('Error getting team details:', error);
    res.status(500).json({ error: 'Failed to get team details' });
  }
});

// Invite user to team
router.post('/teams/:teamId/invite', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const { username, role = 'member' } = req.body;
    
    const team = teams.get(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const members = teamMembers.get(teamId) || [];
    const currentMember = members.find(m => m.userId === req.user.userId);
    
    if (!currentMember || (currentMember.role !== 'owner' && currentMember.role !== 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    const userToInvite = users.get(username);
    if (!userToInvite) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const alreadyMember = members.some(m => m.userId === userToInvite.id);
    if (alreadyMember) {
      return res.status(400).json({ error: 'User is already a team member' });
    }
    
    members.push({
      userId: userToInvite.id,
      role,
      joinedAt: Date.now()
    });
    
    teamMembers.set(teamId, members);
    
    res.json({
      message: 'User invited to team successfully',
      member: {
        userId: userToInvite.id,
        username: userToInvite.username,
        fullName: userToInvite.fullName,
        role
      }
    });
    
    console.log(`✅ User invited to team: ${username} -> ${team.name}`);
    
  } catch (error) {
    console.error('Error inviting user to team:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

// Remove user from team
router.delete('/teams/:teamId/members/:userId', authenticateToken, (req, res) => {
  try {
    const { teamId, userId } = req.params;
    const team = teams.get(teamId);
    
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const members = teamMembers.get(teamId) || [];
    const currentMember = members.find(m => m.userId === req.user.userId);
    const memberToRemove = members.find(m => m.userId === userId);
    
    if (!currentMember || !memberToRemove) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    // Only owners can remove members, and owners can't remove themselves
    if (currentMember.role !== 'owner' || userId === req.user.userId) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    const updatedMembers = members.filter(m => m.userId !== userId);
    teamMembers.set(teamId, updatedMembers);
    
    res.json({ message: 'Member removed from team successfully' });
    
    console.log(`✅ Member removed from team: ${userId} from ${team.name}`);
    
  } catch (error) {
    console.error('Error removing team member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Update team member role
router.put('/teams/:teamId/members/:userId/role', authenticateToken, (req, res) => {
  try {
    const { teamId, userId } = req.params;
    const { role } = req.body;
    
    if (!['owner', 'admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    const team = teams.get(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const members = teamMembers.get(teamId) || [];
    const currentMember = members.find(m => m.userId === req.user.userId);
    const memberToUpdate = members.find(m => m.userId === userId);
    
    if (!currentMember || !memberToUpdate) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    // Only owners can change roles
    if (currentMember.role !== 'owner') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    // Can't change owner role
    if (memberToUpdate.role === 'owner') {
      return res.status(400).json({ error: 'Cannot change owner role' });
    }
    
    memberToUpdate.role = role;
    
    res.json({
      message: 'Member role updated successfully',
      member: {
        userId: memberToUpdate.userId,
        role: memberToUpdate.role
      }
    });
    
    console.log(`✅ Team member role updated: ${userId} -> ${role} in ${team.name}`);
    
  } catch (error) {
    console.error('Error updating team member role:', error);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

// Get user's projects
router.get('/user/projects', authenticateToken, (req, res) => {
  try {
    const userProjectIds = userProjects.get(req.user.userId) || [];
    const userProjectsList = [];
    
    for (const projectId of userProjectIds) {
      // Note: This would need access to the projects Map from the main server
      // For now, we'll return the project IDs
      userProjectsList.push({
        projectId,
        // Additional project details would be fetched from main projects Map
      });
    }
    
    res.json({ projects: userProjectsList });
  } catch (error) {
    console.error('Error getting user projects:', error);
    res.status(500).json({ error: 'Failed to get user projects' });
  }
});

// Share project with team
router.post('/projects/:projectId/share', authenticateToken, (req, res) => {
  try {
    const { projectId } = req.params;
    const { teamId, permission = 'read' } = req.body;
    
    // Note: This would need access to the projects Map from the main server
    // For now, we'll just validate the team access
    
    const team = teams.get(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const members = teamMembers.get(teamId) || [];
    const isMember = members.some(m => m.userId === req.user.userId);
    
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this team' });
    }
    
    res.json({
      message: 'Project shared with team successfully',
      shared: {
        projectId,
        teamId,
        permission
      }
    });
    
    console.log(`✅ Project shared with team: ${projectId} -> ${team.name}`);
    
  } catch (error) {
    console.error('Error sharing project:', error);
    res.status(500).json({ error: 'Failed to share project' });
  }
});

// Export the router and utility functions
module.exports = {
  router,
  authenticateToken,
  users,
  teams,
  teamMembers,
  userProjects,
  userSessions
};
