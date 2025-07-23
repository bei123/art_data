// 搜索接口
app.get('/api/search', async (req, res) => {
    try {
      const { keyword, type } = req.query;
      // 输入验证
      if (!keyword || typeof keyword !== 'string') {
        return res.status(400).json({ error: '请输入有效的搜索关键词' });
      }
      // 清理和验证关键词
      const cleanKeyword = keyword.trim();
      if (cleanKeyword.length < 1 || cleanKeyword.length > 100) {
        return res.status(400).json({ error: '搜索关键词长度必须在1-100个字符之间' });
      }
      // 检查是否包含危险字符
      const dangerousChars = /[<>'"&]/;
      if (dangerousChars.test(cleanKeyword)) {
        return res.status(400).json({ error: '搜索关键词包含无效字符' });
      }
      const searchTerm = `%${cleanKeyword}%`;
      let results = [];
      // 按类型搜索
      if (!type || type === 'all') {
        // 全部类型
        const [artistRows] = await db.query(
          `SELECT id, name, avatar, description, 'artist' as type 
           FROM artists 
           WHERE name LIKE ? OR description LIKE ?`,
          [searchTerm, searchTerm]
        );
        const [artworkRows] = await db.query(
          `SELECT id, title, image, description, 'original_artwork' as type 
           FROM original_artworks 
           WHERE title LIKE ? OR description LIKE ?`,
          [searchTerm, searchTerm]
        );
        const [digitalRows] = await db.query(
          `SELECT id, title, image_url as image, description, 'digital_artwork' as type 
           FROM digital_artworks 
           WHERE title LIKE ? OR description LIKE ?`,
          [searchTerm, searchTerm]
        );
        results = [
          ...artistRows.map(item => ({
            ...item,
            avatar: item.avatar ? (item.avatar.startsWith('http') ? item.avatar : `${BASE_URL}${item.avatar}`) : ''
          })),
          ...artworkRows.map(item => ({
            ...item,
            image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
          })),
          ...digitalRows.map(item => ({
            ...item,
            image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
          }))
        ];
      } else if (type === 'artist') {
        const [artistRows] = await db.query(
          `SELECT id, name, avatar, description, 'artist' as type 
           FROM artists 
           WHERE name LIKE ? OR description LIKE ?`,
          [searchTerm, searchTerm]
        );
        results = artistRows.map(item => ({
          ...item,
          avatar: item.avatar ? (item.avatar.startsWith('http') ? item.avatar : `${BASE_URL}${item.avatar}`) : ''
        }));
      } else if (type === 'original_artwork') {
        const [artworkRows] = await db.query(
          `SELECT id, title, image, description, 'original_artwork' as type 
           FROM original_artworks 
           WHERE title LIKE ? OR description LIKE ?`,
          [searchTerm, searchTerm]
        );
        results = artworkRows.map(item => ({
          ...item,
          image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
        }));
      } else if (type === 'digital_artwork') {
        const [digitalRows] = await db.query(
          `SELECT id, title, image_url as image, description, 'digital_artwork' as type 
           FROM digital_artworks 
           WHERE title LIKE ? OR description LIKE ?`,
          [searchTerm, searchTerm]
        );
        results = digitalRows.map(item => ({
          ...item,
          image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
        }));
      } else {
        return res.status(400).json({ error: '不支持的type类型' });
      }
      res.json(results);
    } catch (error) {
      console.error('搜索失败:', error);
      res.status(500).json({ error: '搜索服务暂时不可用，请稍后再试' });
    }
  });