const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function handleResponse(response) {
  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');

  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMessage = isJson ? (data.msg || data.error || data.message || 'Request failed') : data;
    const errorType = isJson ? (data.error_type || 'http_error') : 'network_error';
    
    // Special handling for database errors
    if (errorType === 'database_error') {
      console.error('Database connection error:', errorMessage);
      throw new ApiError('Database is temporarily unavailable. Please try again in a few minutes.', response.status, data);
    }
    
    throw new ApiError(errorMessage, response.status, data);
  }

  if (isJson && data && data.success === false) {
    const errorMessage = data.msg || data.error || 'Request failed';
    const errorType = data.error_type || 'api_error';
    
    // Special handling for database errors
    if (errorType === 'database_error') {
      console.error('Database connection error:', errorMessage);
      throw new ApiError('Database is temporarily unavailable. Please try again in a few minutes.', response.status, data);
    }
    
    throw new ApiError(errorMessage, response.status, data);
  }

  return data;
}

async function request(endpoint, options = {}) {
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  // Add timeout to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
  config.signal = controller.signal;

  try {
    console.log(`API Request: ${config.method || 'GET'} ${API_BASE_URL}${endpoint}`);
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
    clearTimeout(timeoutId);
    return await handleResponse(response);
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new ApiError('Request timed out. Please check your connection and try again.', 0, null);
    }
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    // Network errors
    if (error.message === 'Failed to fetch') {
      console.error('Network error - unable to connect to backend:', error);
      throw new ApiError('Unable to connect to the server. Please check if the backend is running on ' + API_BASE_URL, 0, null);
    }
    
    throw new ApiError(error.message || 'Network error', 0, null);
  }
}

export const api = {
  get: (endpoint, options = {}) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, data, options = {}) => request(endpoint, { ...options, method: 'POST', body: JSON.stringify(data) }),
  put: (endpoint, data, options = {}) => request(endpoint, { ...options, method: 'PUT', body: JSON.stringify(data) }),
  delete: (endpoint, options = {}) => request(endpoint, { ...options, method: 'DELETE' }),
};

export { ApiError };
