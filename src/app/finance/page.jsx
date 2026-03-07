'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const CATEGORIES = [{name:'Food',emoji:'🍔'},{name:'Travel',emoji:'🚗'},{name:'Shopping',emoji:'🛍️'},{name:'Entertainment',emoji:'🎬'},{name:'Bills',emoji:'📄'},{name:'Health',emoji:'⚕️'},{name:'Other',emoji:'📌'}];

export default function FinancePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('expenses');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState({description:'', amount:'', category:'Food', expense_date: new Date().toISOString().split('T')[0]});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        const [expResult, budResult, subResult] = await Promise.all([
          supabase.from('expenses').select('*').eq('user_id', session.user.id).order('expense_date', {ascending: false}),
          supabase.from('budgets').select('*').eq('user_id', session.user.id),
          supabase.from('subscriptions').select('*').eq('user_id', session.user.id),
        ]);
        setExpenses(expResult.data || []);
        setBudgets(budResult.data || []);
        setSubscriptions(subResult.data || []);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddExpense = async () => {
    if (!expenseForm.description.trim() || !expenseForm.amount) {
      alert('Fill all fields');
      return;
    }

    try {
      const { data, error } = await supabase.from('expenses').insert([{
        user_id: user.id,
        description: expenseForm.description,
        amount: parseFloat(expenseForm.amount),
        category: expenseForm.category.toLowerCase(),
        expense_date: expenseForm.expense_date,
        payment_method: 'cash',
      }]).select();

      if (error) throw error;
      if (data && data.length > 0) {
        setExpenses([data[0], ...expenses]);
        setExpenseForm({description:'', amount:'', category:'Food', expense_date: new Date().toISOString().split('T')[0]});
        setShowExpenseForm(false);
        alert('Expense added!');
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  };

  const handleDeleteExpense = async (id) => {
    try {
      await supabase.from('expenses').delete().eq('id', id);
      setExpenses(expenses.filter(e => e.id !== id));
    } catch (error) {
      alert('Error deleting');
    }
  };

  if (loading) return <div style={{padding:'20px', textAlign:'center', color:'#94a3b8'}}>Loading...</div>;

  const totalExpenses = expenses.reduce((sum,e) => sum + (parseFloat(e.amount)||0), 0);

  return (
    <div style={{minHeight:'100vh', backgroundColor:'#0a0a0f', color:'#f1f5f9', padding:'20px'}}>
      <div style={{maxWidth:'600px', margin:'0 auto'}}>
        <div style={{marginBottom:'20px', display:'flex', justifyContent:'space-between'}}>
          <h1 style={{fontSize:'28px', fontWeight:'800', margin:0}}>💰 Finance</h1>
          <button onClick={() => router.push('/dashboard')} style={{backgroundColor:'#6366f1', color:'#fff', border:'none', padding:'8px 16px', borderRadius:'6px', cursor:'pointer', fontSize:'12px'}}>← Back</button>
        </div>

        <div style={{backgroundColor:'#0f0f1a', border:'1px solid #1e293b', borderRadius:'12px', padding:'16px', marginBottom:'24px'}}>
          <div style={{fontSize:'11px', color:'#94a3b8', marginBottom:'4px'}}>Total Expenses</div>
          <div style={{fontSize:'24px', fontWeight:'700', color:'#6366f1'}}>₹{totalExpenses.toLocaleString('en-IN', {maximumFractionDigits:0})}</div>
        </div>

        <button onClick={() => setShowExpenseForm(!showExpenseForm)} style={{width:'100%', backgroundColor:'#6366f1', color:'#fff', border:'none', padding:'12px', borderRadius:'8px', cursor:'pointer', marginBottom:'16px', fontWeight:'600'}}>+ Add Expense</button>

        {showExpenseForm && (
          <div style={{backgroundColor:'#0f0f1a', border:'1px solid #1e293b', borderRadius:'12px', padding:'16px', marginBottom:'20px'}}>
            <input type="text" placeholder="Description" value={expenseForm.description} onChange={(e) => setExpenseForm({...expenseForm, description:e.target.value})} style={{width:'100%', padding:'10px', marginBottom:'10px', backgroundColor:'#1a1a2e', border:'1px solid #334155', color:'#f1f5f9', borderRadius:'6px', fontSize:'12px', boxSizing:'border-box'}} />
            <input type="number" placeholder="Amount" value={expenseForm.amount} onChange={(e) => setExpenseForm({...expenseForm, amount:e.target.value})} style={{width:'100%', padding:'10px', marginBottom:'10px', backgroundColor:'#1a1a2e', border:'1px solid #334155', color:'#f1f5f9', borderRadius:'6px', fontSize:'12px', boxSizing:'border-box'}} />
            <select value={expenseForm.category} onChange={(e) => setExpenseForm({...expenseForm, category:e.target.value})} style={{width:'100%', padding:'10px', marginBottom:'10px', backgroundColor:'#1a1a2e', border:'1px solid #334155', color:'#f1f5f9', borderRadius:'6px', fontSize:'12px', boxSizing:'border-box'}}>
              {CATEGORIES.map(cat => (<option key={cat.name} value={cat.name}>{cat.name}</option>))}
            </select>
            <input type="date" value={expenseForm.expense_date} onChange={(e) => setExpenseForm({...expenseForm, expense_date:e.target.value})} style={{width:'100%', padding:'10px', marginBottom:'10px', backgroundColor:'#1a1a2e', border:'1px solid #334155', color:'#f1f5f9', borderRadius:'6px', fontSize:'12px', boxSizing:'border-box'}} />
            <div style={{display:'flex', gap:'10px'}}>
              <button onClick={handleAddExpense} style={{flex:1, backgroundColor:'#6366f1', color:'#fff', border:'none', padding:'10px', borderRadius:'6px', cursor:'pointer', fontSize:'12px', fontWeight:'600'}}>Save</button>
              <button onClick={() => setShowExpenseForm(false)} style={{flex:1, backgroundColor:'#1a1a2e', color:'#94a3b8', border:'1px solid #334155', padding:'10px', borderRadius:'6px', cursor:'pointer', fontSize:'12px'}}>Cancel</button>
            </div>
          </div>
        )}

        {expenses.length > 0 && (
          <div>
            <h3 style={{fontSize:'14px', fontWeight:'600', marginBottom:'12px'}}>Expenses</h3>
            {expenses.map(exp => {
              const cat = CATEGORIES.find(c => c.name.toLowerCase() === exp.category) || CATEGORIES[6];
              return (
                <div key={exp.id} style={{backgroundColor:'#0f0f1a', border:'1px solid #1e293b', borderRadius:'10px', padding:'12px', marginBottom:'8px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <div style={{display:'flex', alignItems:'center', gap:'10px', flex:1}}>
                    <span style={{fontSize:'20px'}}>{cat.emoji}</span>
                    <div>
                      <div style={{fontSize:'12px', fontWeight:'600'}}>{exp.description}</div>
                      <div style={{fontSize:'10px', color:'#64748b'}}>{new Date(exp.expense_date).toLocaleDateString('en-IN')}</div>
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:'12px', fontWeight:'700', color:'#ef4444'}}>₹{parseFloat(exp.amount).toLocaleString('en-IN')}</div>
                    <button onClick={() => handleDeleteExpense(exp.id)} style={{backgroundColor:'transparent', border:'none', color:'#64748b', fontSize:'10px', cursor:'pointer'}}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
