"""
Utility functions for running shell commands
"""
import asyncio
import logging
import subprocess
import os
from pathlib import Path

logger = logging.getLogger(__name__)

from typing import Optional, List, Dict

# Environment variables to pass to all subprocesses
SUBPROCESS_ENV = {
    **os.environ,
    "QT_QPA_PLATFORM": "offscreen",  # Headless rendering mode
}

async def run_command(
    cmd: List[str],
    cwd: Optional[Path] = None,
    timeout: Optional[int] = None,
    env: Optional[Dict[str, str]] = None
) -> tuple:
    """
    Run a shell command asynchronously
    
    Args:
        cmd: Command and arguments as list
        cwd: Working directory
        timeout: Timeout in seconds
        env: Environment variables (defaults to SUBPROCESS_ENV with QT_QPA_PLATFORM=offscreen)
    
    Returns:
        Tuple of (stdout, stderr)
    
    Raises:
        subprocess.CalledProcessError: If command fails
    """
    logger.debug(f"Running command: {' '.join(cmd)}")
    
    # Use provided env or default to SUBPROCESS_ENV
    command_env = env if env is not None else SUBPROCESS_ENV
    
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd) if cwd else None,
            env=command_env
        )
        
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout
        )
        
        stdout_str = stdout.decode('utf-8')
        stderr_str = stderr.decode('utf-8')
        
        if process.returncode != 0:
            logger.error(f"Command failed with return code {process.returncode}")
            logger.error(f"Command: {' '.join(str(c) for c in cmd)}")
            logger.error(f"Working directory: {cwd}")
            logger.error(f"STDOUT:\n{stdout_str}")
            logger.error(f"STDERR:\n{stderr_str}")
            raise subprocess.CalledProcessError(
                process.returncode,
                cmd,
                stdout_str,
                stderr_str
            )
        
        return stdout_str, stderr_str
        
    except asyncio.TimeoutError:
        logger.error(f"Command timed out after {timeout} seconds")
        raise
    except Exception as e:
        logger.error(f"Error running command: {e}")
        raise
