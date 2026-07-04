-- Revenue Introduction Documents
-- Stores documentation files for the Revenue module's "Introduction" section

CREATE TABLE IF NOT EXISTS revenue_intro_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  cloudinary_id VARCHAR(500) DEFAULT NULL,
  file_type VARCHAR(50) DEFAULT 'pdf',
  uploaded_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
