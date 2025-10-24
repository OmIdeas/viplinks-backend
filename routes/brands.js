// ========================================
// BRANDS ROUTES - Multi-Branding System
// ========================================

// GET - Obtener todas las marcas del usuario
app.get('/api/brands', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { data: brands, error } = await supabaseAdmin
      .from('brands')
      .select('*')
      .eq('user_id', profile.id)
      .eq('active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ brands: brands || [] });
  } catch (error) {
    console.error('❌ Error obteniendo marcas:', error);
    res.status(500).json({ error: 'Error al obtener marcas' });
  }
});

// POST - Crear nueva marca
app.post('/api/brands', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });

    // Verificar cuántas marcas activas tiene el usuario
    const { data: existingBrands, error: countError } = await supabaseAdmin
      .from('brands')
      .select('id, is_default')
      .eq('user_id', profile.id)
      .eq('active', true);

    if (countError) throw countError;

    // Límite: 3 marcas máximo
    if (existingBrands.length >= 3) {
      return res.status(400).json({ 
        error: 'Límite alcanzado',
        message: 'Ya tienes el máximo de 3 marcas. Elimina una para crear otra.'
      });
    }

    const { brand_name, brand_logo, brand_colors } = req.body;

    if (!brand_name || brand_name.trim() === '') {
      return res.status(400).json({ error: 'El nombre de la marca es requerido' });
    }

    // Determinar si es la primera marca (gratis) o premium
    const isFirstBrand = existingBrands.length === 0;
    const is_default = isFirstBrand;
    const is_premium = !isFirstBrand; // Marca 2 y 3 son premium

    const newBrand = {
      user_id: profile.id,
      brand_name: brand_name.trim(),
      brand_logo: brand_logo || null,
      brand_colors: brand_colors || { background: 'default' },
      is_default,
      is_premium,
      active: true
    };

    const { data: brand, error: insertError } = await supabaseAdmin
      .from('brands')
      .insert([newBrand])
      .select()
      .single();

    if (insertError) throw insertError;

    console.log(`✅ Nueva marca creada: ${brand_name} (${is_premium ? 'Premium' : 'Gratis'})`);

    res.json({ 
      success: true, 
      brand,
      message: `Marca "${brand_name}" creada exitosamente`
    });

  } catch (error) {
    console.error('❌ Error creando marca:', error);
    res.status(500).json({ error: 'Error al crear marca' });
  }
});

// PUT - Actualizar marca existente
app.put('/api/brands/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { id } = req.params;
    const { brand_name, brand_logo, brand_colors } = req.body;

    // Verificar que la marca pertenece al usuario
    const { data: existingBrand, error: checkError } = await supabaseAdmin
      .from('brands')
      .select('*')
      .eq('id', id)
      .eq('user_id', profile.id)
      .single();

    if (checkError || !existingBrand) {
      return res.status(404).json({ error: 'Marca no encontrada' });
    }

    const updates = {
      updated_at: new Date().toISOString()
    };

    if (brand_name) updates.brand_name = brand_name.trim();
    if (brand_logo !== undefined) updates.brand_logo = brand_logo;
    if (brand_colors) updates.brand_colors = brand_colors;

    const { data: updatedBrand, error: updateError } = await supabaseAdmin
      .from('brands')
      .update(updates)
      .eq('id', id)
      .eq('user_id', profile.id)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ Marca actualizada: ${updatedBrand.brand_name}`);

    res.json({ 
      success: true, 
      brand: updatedBrand,
      message: 'Marca actualizada exitosamente'
    });

  } catch (error) {
    console.error('❌ Error actualizando marca:', error);
    res.status(500).json({ error: 'Error al actualizar marca' });
  }
});

// DELETE - Eliminar marca
app.delete('/api/brands/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { id } = req.params;

    // Verificar que la marca pertenece al usuario
    const { data: existingBrand, error: checkError } = await supabaseAdmin
      .from('brands')
      .select('*')
      .eq('id', id)
      .eq('user_id', profile.id)
      .single();

    if (checkError || !existingBrand) {
      return res.status(404).json({ error: 'Marca no encontrada' });
    }

    // No permitir eliminar la marca por defecto si es la única
    if (existingBrand.is_default) {
      const { data: allBrands } = await supabaseAdmin
        .from('brands')
        .select('id')
        .eq('user_id', profile.id)
        .eq('active', true);

      if (allBrands && allBrands.length === 1) {
        return res.status(400).json({ 
          error: 'No se puede eliminar',
          message: 'No puedes eliminar tu única marca. Debes tener al menos una marca activa.'
        });
      }
    }

    // Soft delete (marcar como inactiva en lugar de eliminar)
    const { error: deleteError } = await supabaseAdmin
      .from('brands')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', profile.id);

    if (deleteError) throw deleteError;

    console.log(`✅ Marca eliminada: ${existingBrand.brand_name}`);

    res.json({ 
      success: true,
      message: 'Marca eliminada exitosamente'
    });

  } catch (error) {
    console.error('❌ Error eliminando marca:', error);
    res.status(500).json({ error: 'Error al eliminar marca' });
  }
});
