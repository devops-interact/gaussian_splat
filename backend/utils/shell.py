"""
Utility functions for running shell commands
"""
import asyncio
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

from typing import Optional, List

async def run_command(
    cmd: List[str],
    cwd: Optional[Path] = None,
    timeout: Optional[int] = None
) -> tuple:
    """
    Run a shell command asynchronously
    
    Args:
        cmd: Command and arguments as list
        cwd: Working directory
        timeout: Timeout in seconds
    
    Returns:
        Tuple of (stdout, stderr)
    
    Raises:
        subprocess.CalledProcessError: If command fails
    """
    logger.debug(f"Running command: {' '.join(cmd)}")
    
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd) if cwd else None
        )
        
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout
        )
        
        stdout_str = stdout.decode('utf-8')
        stderr_str = stderr.decode('utf-8')
        
        if process.returncode != 0:
            logger.error(f"Command failed with return code {process.returncode}")
            logger.error(f"stderr: {stderr_str}")
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
