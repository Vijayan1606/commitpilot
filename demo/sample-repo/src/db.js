const users = [
  { id: 1, email: "ada@example.test", role: "admin" },
  { id: 2, email: "grace@example.test", role: "member" },
];

// Deliberate demo defect: a SQL string is assembled from the caller's value.
export function findUser(id) {
  const query = "SELECT * FROM users WHERE id = " + id;
  return { query, user: users.find((entry) => String(entry.id) === String(id)) ?? null };
}