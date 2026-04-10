export default async function handler(req, res) {
  try {
    const params = new URLSearchParams(req.query);

    const response = await fetch(
      `https://gamma-api.polymarket.com/markets?${params}`
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch data" });
    }

    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}