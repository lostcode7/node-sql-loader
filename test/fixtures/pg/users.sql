-- name: findById
-- @returns zero-or-one
SELECT * FROM users WHERE id = :id;

-- name: listByStatus
-- @returns many
SELECT * FROM users WHERE status = :status AND org = :org AND status <> :status;
