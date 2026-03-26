import React, { useState } from 'react';

export default function AddProjectModal({ onClose, onSave, saving = false }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    image_url: '',
  });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (name === 'image_url') {
      setPreview(value || null);
    }
    if (error) {
      setError('');
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setPreview(result);
      setFormData((prev) => ({ ...prev, image_url: result }));
      setError('');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const title = formData.title.trim();
    const description = formData.description.trim();
    const imageUrl = (formData.image_url || '').trim();

    if (!title || !description) {
      setError('Title and description are required.');
      return;
    }

    if (!imageUrl) {
      setError('Please upload an image or paste an image URL.');
      return;
    }

    setError('');
    onSave({
      title,
      description,
      image_url: imageUrl,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="add-project-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Add Portfolio Item</h3>
          <button type="button" className="close-btn" onClick={onClose}>&times;</button>
        </header>

        <form id="portfolio-item-form" onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label>Title</label>
            <input
              name="title"
              placeholder="e.g. Bridal Mehendi Collection"
              value={formData.title}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              placeholder="Describe the work, event, or style shown in this portfolio item..."
              value={formData.description}
              onChange={handleChange}
              rows={4}
              required
            />
          </div>

          <div className="form-group">
            <label>Image URL</label>
            <input
              name="image_url"
              placeholder="https://example.com/portfolio-image.jpg"
              value={formData.image_url}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Upload Image</label>
            {preview ? (
              <div className="preview-container">
                <img src={preview} alt="Portfolio Preview" />
                <button
                  type="button"
                  className="remove-preview"
                  onClick={() => {
                    setPreview(null);
                    setFormData((prev) => ({ ...prev, image_url: '' }));
                  }}
                >
                  &times;
                </button>
              </div>
            ) : (
              <label className="image-dropzone">
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📸</div>
                <div style={{ fontWeight: 500, color: '#2563eb' }}>Click to upload image</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>PNG, JPG or JPEG</div>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
              </label>
            )}
          </div>

          {error && (
            <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 12px', borderRadius: '10px', fontSize: '14px' }}>
              {error}
            </div>
          )}
        </form>

        <footer className="modal-footer">
          <button type="button" className="secondary-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="portfolio-item-form" className="db-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Portfolio Item'}
          </button>
        </footer>
      </div>
    </div>
  );
}
