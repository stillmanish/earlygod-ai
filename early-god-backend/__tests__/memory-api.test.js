/**
 * Memory API Endpoint Tests
 * Tests for /api/memory/* endpoints
 */

const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

// Mock database
jest.mock('pg', () => {
    const mockPool = {
        query: jest.fn(),
    };
    return { Pool: jest.fn(() => mockPool) };
});

describe('Memory API Endpoints', () => {
    let app;
    let mockPool;

    beforeAll(() => {
        // Create Express app with memory endpoints
        app = express();
        app.use(express.json());

        // Initialize mock pool
        mockPool = new Pool();

        // Store Event Endpoint
        app.post('/api/memory/store-event', async (req, res) => {
            try {
                const { gameTitle, category, eventType, entityName, context, userId } = req.body;

                if (!gameTitle || !category || !entityName) {
                    return res.status(400).json({ error: 'Required fields missing' });
                }

                const result = await mockPool.query(
                    `INSERT INTO long_term_memory (user_id, game_title, category, event_type, entity_name, context)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                    [userId || null, gameTitle, category, eventType || null, entityName, context || null]
                );

                res.json({ success: true, id: result.rows[0].id });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get Events Endpoint
        app.get('/api/memory/events/:gameTitle', async (req, res) => {
            try {
                const { gameTitle } = req.params;
                const { category, limit = 50 } = req.query;

                let query = 'SELECT * FROM long_term_memory WHERE game_title = $1';
                const params = [gameTitle];

                if (category) {
                    query += ' AND category = $2';
                    params.push(category);
                    query += ' ORDER BY timestamp DESC LIMIT $3';
                    params.push(parseInt(limit));
                } else {
                    query += ' ORDER BY timestamp DESC LIMIT $2';
                    params.push(parseInt(limit));
                }

                const result = await mockPool.query(query, params);
                res.json({ success: true, events: result.rows });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Clear Events Endpoint
        app.delete('/api/memory/events/:gameTitle', async (req, res) => {
            try {
                const { gameTitle } = req.params;

                const result = await mockPool.query(
                    'DELETE FROM long_term_memory WHERE game_title = $1',
                    [gameTitle]
                );

                res.json({ success: true, deleted: result.rowCount });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/memory/store-event', () => {
        it('should store a boss defeat event', async () => {
            mockPool.query.mockResolvedValueOnce({
                rows: [{ id: 1 }]
            });

            const response = await request(app)
                .post('/api/memory/store-event')
                .send({
                    gameTitle: 'Clair Obscur: Expedition 33',
                    category: 'boss',
                    eventType: 'defeated',
                    entityName: 'Luna',
                    context: 'Victory screen showing Luna Defeated with XP +5000'
                });

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ success: true, id: 1 });
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO long_term_memory'),
                [null, 'Clair Obscur: Expedition 33', 'boss', 'defeated', 'Luna', 'Victory screen showing Luna Defeated with XP +5000']
            );
        });

        it('should store a checkpoint event', async () => {
            mockPool.query.mockResolvedValueOnce({
                rows: [{ id: 2 }]
            });

            const response = await request(app)
                .post('/api/memory/store-event')
                .send({
                    gameTitle: 'Clair Obscur: Expedition 33',
                    category: 'checkpoint',
                    eventType: 'reached',
                    entityName: 'Grand Meadow',
                    context: 'Checkpoint flag UI visible'
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('should store an item obtained event', async () => {
            mockPool.query.mockResolvedValueOnce({
                rows: [{ id: 3 }]
            });

            const response = await request(app)
                .post('/api/memory/store-event')
                .send({
                    gameTitle: 'Clair Obscur: Expedition 33',
                    category: 'item',
                    eventType: 'obtained',
                    entityName: 'Resin'
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('should return 400 if gameTitle is missing', async () => {
            const response = await request(app)
                .post('/api/memory/store-event')
                .send({
                    category: 'boss',
                    entityName: 'Luna'
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Required fields missing');
        });

        it('should return 400 if category is missing', async () => {
            const response = await request(app)
                .post('/api/memory/store-event')
                .send({
                    gameTitle: 'Test Game',
                    entityName: 'Luna'
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Required fields missing');
        });

        it('should return 400 if entityName is missing', async () => {
            const response = await request(app)
                .post('/api/memory/store-event')
                .send({
                    gameTitle: 'Test Game',
                    category: 'boss'
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Required fields missing');
        });

        it('should handle database errors gracefully', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Database connection failed'));

            const response = await request(app)
                .post('/api/memory/store-event')
                .send({
                    gameTitle: 'Test Game',
                    category: 'boss',
                    entityName: 'Luna'
                });

            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Database connection failed');
        });
    });

    describe('GET /api/memory/events/:gameTitle', () => {
        it('should retrieve all events for a game', async () => {
            const mockEvents = [
                {
                    id: 1,
                    game_title: 'Clair Obscur: Expedition 33',
                    category: 'boss',
                    event_type: 'defeated',
                    entity_name: 'Luna',
                    timestamp: new Date()
                },
                {
                    id: 2,
                    game_title: 'Clair Obscur: Expedition 33',
                    category: 'checkpoint',
                    event_type: 'reached',
                    entity_name: 'Grand Meadow',
                    timestamp: new Date()
                }
            ];

            mockPool.query.mockResolvedValueOnce({
                rows: mockEvents
            });

            const response = await request(app)
                .get('/api/memory/events/Clair Obscur: Expedition 33');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.events).toHaveLength(2);
            expect(response.body.events[0].entity_name).toBe('Luna');
        });

        it('should filter events by category', async () => {
            const mockBossEvents = [
                {
                    id: 1,
                    category: 'boss',
                    entity_name: 'Luna'
                }
            ];

            mockPool.query.mockResolvedValueOnce({
                rows: mockBossEvents
            });

            const response = await request(app)
                .get('/api/memory/events/Clair Obscur: Expedition 33?category=boss');

            expect(response.status).toBe(200);
            expect(response.body.events).toHaveLength(1);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('AND category = $2'),
                expect.arrayContaining(['Clair Obscur: Expedition 33', 'boss', 50])
            );
        });

        it('should respect limit parameter', async () => {
            mockPool.query.mockResolvedValueOnce({
                rows: []
            });

            await request(app)
                .get('/api/memory/events/Test Game?limit=10');

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining([10])
            );
        });

        it('should return empty array if no events found', async () => {
            mockPool.query.mockResolvedValueOnce({
                rows: []
            });

            const response = await request(app)
                .get('/api/memory/events/Nonexistent Game');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.events).toHaveLength(0);
        });
    });

    describe('DELETE /api/memory/events/:gameTitle', () => {
        it('should delete all events for a game', async () => {
            mockPool.query.mockResolvedValueOnce({
                rowCount: 5
            });

            const response = await request(app)
                .delete('/api/memory/events/Test Game');

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ success: true, deleted: 5 });
            expect(mockPool.query).toHaveBeenCalledWith(
                'DELETE FROM long_term_memory WHERE game_title = $1',
                ['Test Game']
            );
        });

        it('should return 0 deleted if game has no events', async () => {
            mockPool.query.mockResolvedValueOnce({
                rowCount: 0
            });

            const response = await request(app)
                .delete('/api/memory/events/Nonexistent Game');

            expect(response.status).toBe(200);
            expect(response.body.deleted).toBe(0);
        });
    });
});
