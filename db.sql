-- 创建购物车表
CREATE TABLE IF NOT EXISTS cart_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  right_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES wx_users(id),
  FOREIGN KEY (right_id) REFERENCES rights(id),
  UNIQUE KEY unique_cart_item (user_id, right_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  out_trade_no VARCHAR(64) NOT NULL UNIQUE,
  total_fee DECIMAL(10,2) NOT NULL,
  actual_fee DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  body VARCHAR(128),
  transaction_id VARCHAR(64),
  trade_type VARCHAR(16),
  trade_state VARCHAR(32),
  trade_state_desc VARCHAR(256),
  success_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES wx_users(id)
); 