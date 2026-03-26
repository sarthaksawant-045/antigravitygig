"""
PostgreSQL database configuration for GigBridge
Replaces SQLite with PostgreSQL while maintaining all existing functionality
"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor
import psycopg2.errors
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# PostgreSQL Connection Configuration
# Load from environment variables with secure defaults
def get_postgres_config():
    """Get PostgreSQL configuration from environment variables"""
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        # Cloud Postgres (Neon) DSN-style connection with SSL enforced.
        return {
            "dsn": database_url,
            "sslmode": "require",
            "options": "-c client_encoding=UTF8",
        }

    return {
        'host': os.getenv('POSTGRES_HOST', 'localhost'),
        'port': int(os.getenv('POSTGRES_PORT', '5432')),
        'database': os.getenv('POSTGRES_DB', 'gigbridge'),
        'user': os.getenv('POSTGRES_USER', 'postgres'),
        'password': os.getenv('POSTGRES_PASSWORD', 'Sarthak123'),
        'options': '-c client_encoding=UTF8',
    }

# Global connection pool for better performance
_connection_pool = []
_max_pool_size = 5

def get_postgres_connection():
    """Get a PostgreSQL connection with proper error handling and logging"""
    config = get_postgres_config()
    
    try:
        if "dsn" in config:
            logger.info("Connecting to PostgreSQL via DATABASE_URL (SSL enabled)")
            conn = psycopg2.connect(
                config["dsn"],
                sslmode=config.get("sslmode", "require"),
                options=config.get("options", "-c client_encoding=UTF8"),
            )
        else:
            logger.info(f"Connecting to PostgreSQL: {config['host']}:{config['port']}/{config['database']}")
            conn = psycopg2.connect(**config)
        conn.set_client_encoding("UTF8")
        conn.autocommit = False
        
        # Test the connection
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        
        logger.info("PostgreSQL connection successful")
        return conn
        
    except psycopg2.OperationalError as e:
        logger.error(f"PostgreSQL connection error: {e}")
        if "dsn" not in config:
            logger.error("Please ensure:")
            logger.error(f"  - PostgreSQL is running on {config['host']}:{config['port']}")
            logger.error(f"  - Database '{config['database']}' exists")
            logger.error(f"  - User '{config['user']}' has correct permissions")
            logger.error(f"  - Password is correct")
        logger.error("\nTo start PostgreSQL on Windows:")
        logger.error("  1. Open Services and find 'postgresql-x64-XX'")
        logger.error("  2. Right-click and select 'Start'")
        logger.error("  3. Or run: net start postgresql-x64-XX")
        raise
    except Exception as e:
        logger.error(f"Unexpected database connection error: {e}")
        raise

def test_database_connection():
    """Test database connection and return status"""
    try:
        conn = get_postgres_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT version()")
            version = cursor.fetchone()[0]
        conn.close()
        logger.info(f"Database connection test passed: {version[:50]}...")
        return True
    except Exception as e:
        logger.error(f"Database connection test failed: {e}")
        return False

def ensure_database_exists():
    """Ensure the database exists, create if necessary"""
    config = get_postgres_config()
    db_name = config['database']
    
    try:
        # Connect to default 'postgres' database to create our database
        admin_config = config.copy()
        admin_config['database'] = 'postgres'
        
        conn = psycopg2.connect(**admin_config)
        conn.autocommit = True
        
        with conn.cursor() as cursor:
            # Check if database exists
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
            exists = cursor.fetchone()
            
            if not exists:
                logger.info(f"Creating database '{db_name}'...")
                cursor.execute(f'CREATE DATABASE "{db_name}"')
                logger.info(f"Database '{db_name}' created successfully")
            else:
                logger.info(f"Database '{db_name}' already exists")
                
        conn.close()
        return True
        
    except Exception as e:
        logger.error(f"Failed to ensure database exists: {e}")
        return False

def client_db():
    """Return connection to client database (same PostgreSQL database)"""
    return get_postgres_connection()

def freelancer_db():
    """Return connection to freelancer database (same PostgreSQL database)"""
    return get_postgres_connection()

# PostgreSQL-specific error handling
def is_column_exists_error(error):
    """Check if error is for duplicate column (PostgreSQL)"""
    return isinstance(error, psycopg2.errors.DuplicateColumn)

def is_table_exists_error(error):
    """Check if error is for duplicate table (PostgreSQL)"""
    return isinstance(error, psycopg2.errors.DuplicateTable)

def is_unique_violation_error(error):
    """Check if error is for unique constraint violation"""
    return isinstance(error, psycopg2.errors.UniqueViolation)

# PostgreSQL data type conversions
def convert_sqlite_to_postgres_type(sqlite_type):
    """Convert SQLite data types to PostgreSQL equivalents"""
    type_mapping = {
        'INTEGER PRIMARY KEY AUTOINCREMENT': 'SERIAL PRIMARY KEY',
        'INTEGER PRIMARY KEY': 'SERIAL PRIMARY KEY',
        'INTEGER': 'INTEGER',
        'TEXT': 'TEXT',
        'REAL': 'REAL',
        'BLOB': 'BYTEA',
        'TIMESTAMP': 'TIMESTAMP',
        'BOOLEAN': 'BOOLEAN'
    }
    return type_mapping.get(sqlite_type.upper(), sqlite_type)

# Row factory for dictionary-like access (similar to SQLite's row_factory)
def get_dict_cursor(connection):
    """Get cursor that returns rows as dictionaries"""
    return connection.cursor(cursor_factory=RealDictCursor)


def verify_live_database_connection():
    """Startup verification for live DB connectivity."""
    try:
        conn = get_postgres_connection()
        conn.close()
        print("Connected to LIVE database successfully!")
    except Exception as err:
        print("Database connection error:", err)


# Verify DB connectivity once when module is loaded during server startup.
verify_live_database_connection()
