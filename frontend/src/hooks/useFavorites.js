import { useState, useEffect, useCallback } from 'react';
import { clientService } from '../services';

/**
 * DB-backed favourites hook.
 * Requires the logged-in client's id to be stored in localStorage under
 * "gb_user_data" as { id, role }.
 */
export function useFavorites() {
  const [savedIds, setSavedIds] = useState(new Set());

  const getClientId = () => {
    try {
      const u = JSON.parse(localStorage.getItem('gb_user_data') || '{}');
      return u?.role === 'client' ? u.id : null;
    } catch {
      return null;
    }
  };

  // Load saved list from backend on mount
  useEffect(() => {
    const clientId = getClientId();
    if (!clientId) return;

    clientService.getSavedFreelancers(clientId)
      .then((data) => {
        // data is an array of { id, name, category } objects
        const arr = Array.isArray(data) ? data : (data?.results || []);
        setSavedIds(new Set(arr.map((f) => f.id)));
      })
      .catch(() => {});
  }, []);

  const toggleFavorite = useCallback(async (freelancerId) => {
    const clientId = getClientId();
    if (!clientId) return;

    const alreadySaved = savedIds.has(freelancerId);

    // Optimistic update
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (alreadySaved) {
        next.delete(freelancerId);
      } else {
        next.add(freelancerId);
      }
      return next;
    });

    try {
      if (alreadySaved) {
        await clientService.unsaveFreelancer(clientId, freelancerId);
      } else {
        await clientService.saveFreelancer(clientId, freelancerId);
      }
    } catch {
      // Revert on failure
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (alreadySaved) {
          next.add(freelancerId);
        } else {
          next.delete(freelancerId);
        }
        return next;
      });
    }
  }, [savedIds]);

  const isFavorite = useCallback((id) => savedIds.has(id), [savedIds]);

  return { toggleFavorite, isFavorite };
}
