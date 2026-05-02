const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ============================================
// DATABASE SETUP
// ============================================
const db = new sqlite3.Database(path.join(__dirname, 'habits.db'));

db.serialize(() => {
  // Habits table
  db.run(`CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    goal_type TEXT DEFAULT 'daily',
    goal_target INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Completions table
  db.run(`CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(habit_id, user_id, date)
  )`);

  // Insert sample habits if none exist
  db.get("SELECT COUNT(*) as count FROM habits", (err, row) => {
    if (row && row.count === 0) {
      db.run("INSERT INTO habits (name, user_id, goal_type, goal_target) VALUES ('Exercise', 'user123', 'daily', 1)");
      db.run("INSERT INTO habits (name, user_id, goal_type, goal_target) VALUES ('Read 20 minutes', 'user123', 'daily', 1)");
      db.run("INSERT INTO habits (name, user_id, goal_type, goal_target) VALUES ('Drink 8 glasses of water', 'user123', 'daily', 8)");
      console.log('✅ Sample habits inserted');
    }
  });
});

// ============================================
// STREAK CALCULATOR
// ============================================
function calculateStreak(habitId, userId, callback) {
  const today = new Date().toISOString().split('T')[0];
  
  db.all(
    `SELECT date FROM completions WHERE habit_id = ? AND user_id = ? ORDER BY date DESC`,
    [habitId, userId],
    (err, completions) => {
      if (err || completions.length === 0) return callback(0);
      
      let streak = 0;
      let expectedDate = new Date(today);
      
      for (let i = 0; i < completions.length; i++) {
        const expectedStr = expectedDate.toISOString().split('T')[0];
        if (completions[i].date === expectedStr) {
          streak++;
          expectedDate.setDate(expectedDate.getDate() - 1);
        } else {
          break;
        }
      }
      callback(streak);
    }
  );
}

// ============================================
// GET /api/habits - Get all habits
// ============================================
app.get('/api/habits', (req, res) => {
  const userId = req.query.userId || 'user123';
  const today = new Date().toISOString().split('T')[0];

  db.all("SELECT * FROM habits WHERE user_id = ?", [userId], (err, habits) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (habits.length === 0) return res.json([]);

    db.all("SELECT habit_id FROM completions WHERE user_id = ? AND date = ?", [userId, today], (err, completions) => {
      const completedIds = new Set(completions.map(c => c.habit_id));
      let pending = habits.length;
      const results = [];
      
      habits.forEach(habit => {
        calculateStreak(habit.id, userId, (streak) => {
          results.push({
            id: habit.id,
            name: habit.name,
            completed: completedIds.has(habit.id),
            streak: streak,
            goal_type: habit.goal_type || 'daily',
            goal_target: habit.goal_target || 1,
            progress: completedIds.has(habit.id) ? 1 : 0,
            progress_percent: completedIds.has(habit.id) ? 100 : 0
          });
          pending--;
          if (pending === 0) res.json(results);
        });
      });
    });
  });
});

// ============================================
// POST /api/habits/:id/check - Check in a habit
// ============================================
app.post('/api/habits/:id/check', (req, res) => {
  const habitId = req.params.id;
  const userId = req.body.userId || 'user123';
  const today = new Date().toISOString().split('T')[0];

  db.get("SELECT * FROM completions WHERE habit_id = ? AND user_id = ? AND date = ?", 
    [habitId, userId, today], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (existing) return res.status(400).json({ error: 'Already checked today' });

    db.run("INSERT INTO completions (habit_id, user_id, date) VALUES (?, ?, ?)", 
      [habitId, userId, today], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      calculateStreak(habitId, userId, (streak) => {
        res.json({ 
          success: true, 
          habitId: habitId, 
          streak: streak, 
          message: 'Great job! ' + streak + ' day streak!' 
        });
      });
    });
  });
});

// ============================================
// POST /api/habits - Add a new habit
// ============================================
app.post('/api/habits', (req, res) => {
  const { name, userId, goal_type, goal_target } = req.body;
  const uid = userId || 'user123';
  const goalType = goal_type || 'daily';
  const goalTarget = goal_target || 1;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Habit name required' });
  }

  db.run(
    "INSERT INTO habits (name, user_id, goal_type, goal_target) VALUES (?, ?, ?, ?)",
    [name.trim(), uid, goalType, goalTarget],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({ 
        success: true, 
        habit: { 
          id: this.lastID, 
          name: name.trim(), 
          completed: false, 
          streak: 0,
          goal_type: goalType,
          goal_target: goalTarget,
          progress: 0,
          progress_percent: 0
        } 
      });
    }
  );
});

// ============================================
// DELETE /api/habits/:id - Delete a habit
// ============================================
app.delete('/api/habits/:id', (req, res) => {
  const habitId = req.params.id;
  const userId = req.query.userId || 'user123';

  db.run("DELETE FROM completions WHERE habit_id = ? AND user_id = ?", [habitId, userId]);
  db.run("DELETE FROM habits WHERE id = ? AND user_id = ?", [habitId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

// ============================================
// GET /api/stats - Get statistics
// ============================================
app.get('/api/stats', (req, res) => {
  const userId = req.query.userId || 'user123';
  
  db.get("SELECT COUNT(*) as total FROM habits WHERE user_id = ?", [userId], (err, total) => {
    db.get("SELECT COUNT(*) as completed FROM completions WHERE user_id = ? AND date = ?", 
      [userId, new Date().toISOString().split('T')[0]], (err, today) => {
        res.json({
          totalHabits: total ? total.total : 0,
          completedToday: today ? today.completed : 0,
          chartLabels: [],
          chartData: []
        });
      });
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('✅ Server running at http://localhost:' + PORT);
  console.log('📋 API endpoints:');
  console.log('   GET    /api/habits');
  console.log('   POST   /api/habits');
  console.log('   POST   /api/habits/:id/check');
  console.log('   DELETE /api/habits/:id');
  console.log('   GET    /api/stats');
});