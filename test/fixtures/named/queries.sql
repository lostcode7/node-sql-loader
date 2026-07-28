-- User queries.

-- name: findById
SELECT * FROM users WHERE id = :id;

-- name: insertOne
INSERT INTO users (name)
VALUES (:name);
